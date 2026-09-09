/* Rasumi Store Portal - Mobile JS Controller
 *
 * SECURITY NOTE (read before touching this file): this page used to
 * create a Supabase client directly in the browser with a hardcoded
 * SUPABASE_URL/SUPABASE_ANON_KEY. That key is enough, on its own, to
 * read AND write every store_* table (their RLS is `TO anon USING(true)/
 * WITH CHECK(true)` by design — see sql/store_credential_removal_v6.sql
 * — safe only as long as the key never reaches a public browser). This
 * page IS public (served from rasumigroup.my), so that key would have
 * been extractable by anyone via view-source the moment this file went
 * live.
 *
 * Every data operation now goes through the store-api Cloudflare Worker
 * (cloudflare/store-api/) instead — it holds the real Supabase
 * credentials server-side and does its own login/role/branch checks
 * before touching Supabase. This file only ever sees STORE_API_BASE_URL
 * (a public endpoint, not a secret) and the session token that endpoint
 * issues after a real login.
 */

// Set this to the deployed Worker URL after `npx wrangler deploy` — see
// cloudflare/store-api/README.md. Looks like:
// https://rasumi-store-api.<your-subdomain>.workers.dev
// (or the custom domain, if one was attached in the Cloudflare dashboard)
const STORE_API_BASE_URL = "https://rasumi-store-api.captainclaw77.workers.dev";

const SESSION_STORAGE_KEY = "rasumi_store_mobile_session";
// Long-lived, independent of the 8h session JWT — this is what lets a
// staff member log out/back in on the SAME phone without re-entering a
// TOTP code. Only cleared if the account's admin revokes this device from
// the Admin Console (in which case the next /login attempt gets
// totp_required again, same as a brand new device).
const DEVICE_TOKEN_STORAGE_KEY = "rasumi_store_device_token";

let currentBranch = "FVKL";
let masterlistData = [];
let movementChart = null;
let mobSession = null; // { token, user }
let pendingTotpToken = null; // short-lived, only while mid-2FA-challenge
let qrRenderer = null; // QRCode instance, torn down/recreated per setup screen visit

// Dashboard list data kept in memory so the search boxes on Out of
// Stock/Expiring Soon can filter client-side without re-hitting the API,
// same pattern as masterlistData/filterMobMasterlist().
let dashOutOfStockData = [];
let dashExpiringSoonData = [];
let dashMovementsTab = "fast"; // "fast" | "slow" | "recent" — which list the segmented tab control shows

const DEST_SHORTFORMS = {
    "RASUMI SHAH ALAM": "RSA",
    "FARMASI VETERAN TERENDAK": "FVT",
    "FARMASI VETERAN LUMUT": "FVL",
    "FARMASI VETERAN GEMAS": "FVG",
    "FARMASI VETERAN KUALA LUMPUR": "FVKL",
    "RASUMI HQ": "HQ",
    "STAFF": "STAFF",
};

function formatDestShortform(destStr) {
    if (!destStr) return "HQ";
    const upper = destStr.toUpperCase().trim();
    if (DEST_SHORTFORMS[upper]) return DEST_SHORTFORMS[upper];
    for (const [longName, shortName] of Object.entries(DEST_SHORTFORMS)) {
        if (upper.includes(longName) || longName.includes(upper)) return shortName;
    }
    return destStr.substring(0, 5).toUpperCase();
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
}

// ── 0. store-api fetch helper ───────────────────────────────────────
async function apiFetch(path, { method = "GET", body, auth = true } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (auth && mobSession && mobSession.token) {
        headers.Authorization = `Bearer ${mobSession.token}`;
    }
    const res = await fetch(`${STORE_API_BASE_URL}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
        // Session expired/invalid server-side — force back to login
        // rather than showing a confusing half-loaded app.
        clearMobSession();
        showLoginScreen("Session expired. Please log in again.");
        throw new Error("Session expired.");
    }
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
}

// Separate from apiFetch on purpose: the /totp/* routes accept a
// short-lived pending token (from /login's totp_setup_required /
// totp_required response), never the real mobSession token — reusing
// apiFetch's auth logic would silently send the wrong bearer.
async function totpFetch(path, body) {
    const res = await fetch(`${STORE_API_BASE_URL}${path}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${pendingTotpToken}`,
        },
        body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
}

// ── 1. Device Guard (Mobile-Only Enforcer) ──────────────────────────
function checkDeviceGuard() {
    const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const isSmallScreen = window.innerWidth <= 1024;
    const isMobileDevice = isMobileUA || isSmallScreen;

    if (!isMobileDevice) {
        document.getElementById("mob-login-screen").style.display = "none";
        document.getElementById("mobile-app-wrapper").style.display = "none";
        document.getElementById("desktop-blocked-screen").style.display = "flex";
        return false;
    }
    document.getElementById("desktop-blocked-screen").style.display = "none";
    return true;
}

// ── 2. Session persistence ──────────────────────────────────────────
function loadStoredSession() {
    try {
        const raw = localStorage.getItem(SESSION_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function saveMobSession(session) {
    mobSession = session;
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

function clearMobSession() {
    mobSession = null;
    localStorage.removeItem(SESSION_STORAGE_KEY);
}

function loadStoredDeviceToken() {
    try {
        return localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY) || null;
    } catch {
        return null;
    }
}

function saveDeviceToken(token) {
    if (!token) return;
    try {
        localStorage.setItem(DEVICE_TOKEN_STORAGE_KEY, token);
    } catch {
        // localStorage unavailable (private browsing etc.) — device just
        // won't be remembered; every login will re-prompt for TOTP. Not
        // fatal, so fail silently rather than blocking login.
    }
}

function hideAllAuthScreens() {
    document.getElementById("mob-login-screen").style.display = "none";
    document.getElementById("mob-totp-setup-screen").style.display = "none";
    document.getElementById("mob-totp-verify-screen").style.display = "none";
    document.getElementById("mobile-app-wrapper").style.display = "none";
}

function showLoginScreen(errorMsg) {
    hideAllAuthScreens();
    document.getElementById("mob-login-screen").style.display = "flex";
    const errEl = document.getElementById("mob-login-error");
    if (errorMsg) {
        errEl.textContent = errorMsg;
        errEl.style.display = "block";
    } else {
        errEl.style.display = "none";
    }
}

function showTotpSetupScreen(secret, otpauthUri) {
    hideAllAuthScreens();
    document.getElementById("mob-totp-setup-screen").style.display = "flex";
    document.getElementById("mob-totp-secret-fallback").textContent = secret;

    const qrEl = document.getElementById("mob-totp-qr");
    qrEl.innerHTML = "";
    qrRenderer = new QRCode(qrEl, { text: otpauthUri, width: 180, height: 180 });
}

function showTotpVerifyScreen() {
    hideAllAuthScreens();
    document.getElementById("mob-totp-verify-screen").style.display = "flex";
}

async function showAppScreen() {
    hideAllAuthScreens();
    document.getElementById("mobile-app-wrapper").style.display = "block";
    // SUPER_ADMIN accounts carry home_branch_code = "ALL" (all-branch
    // access), which isn't a real store_locations row — passing it
    // straight to /dashboard, /masterlist etc. gets rejected server-side
    // ("Branch ALL does not exist."). Fall back to the default FVKL for
    // those accounts; the branch selector still lets them switch to any
    // real branch afterward.
    const homeBranch = mobSession && mobSession.user && mobSession.user.home_branch_code;
    if (homeBranch && homeBranch.toUpperCase() !== "ALL") {
        currentBranch = homeBranch;
        const sel = document.getElementById("mob-branch-select");
        if (sel) sel.value = currentBranch;
    }
    renderMobGreeting();
    await loadMobMasterlist();
    await loadMobDashboardStats();
    loadMobBinCardDropdown();
}

// Time-based greeting using the logged-in staff's own name (already in
// the session — no backend change needed) + today's date computed
// client-side. Branch chip is updated separately by
// loadMobDashboardStats() (id="dt-dash-branch").
function renderMobGreeting() {
    const hour = new Date().getHours();
    const label = hour < 12 ? "Good Morning," : hour < 18 ? "Good Afternoon," : "Good Evening,";
    setText("dt-greeting-label", label);

    const user = mobSession && mobSession.user;
    const name = (user && (user.full_name || user.name)) || "Staff";
    setText("dt-greeting-name", name.toUpperCase());

    const dateStr = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    setText("dt-greeting-date-text", dateStr);
}

// ── Header: notification bell + profile menu ────────────────────────
// Bell scrolls to the real Alerts & Notifications panel instead of
// duplicating it as a separate fake notification list; its badge is the
// same real alert count that panel computes (see renderDashAlerts()).
function renderHeaderNotifBadge(count) {
    const badge = document.getElementById("mob-notif-badge");
    if (!badge) return;
    if (count > 0) {
        badge.textContent = count > 9 ? "9+" : String(count);
        badge.style.display = "flex";
    } else {
        badge.style.display = "none";
    }
}

function toggleNotifPanel() {
    closeProfileMenu();
    switchMobTab("dash");
    const anchor = document.getElementById("panel-alerts-anchor");
    if (anchor) anchor.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Profile menu — real session data only (name/role/branch), no invented
// "Settings" screens with nothing behind them. SUPER_ADMIN accounts get
// the branch switcher here (moved out of the header); everyone else just
// sees their own name/role + Log Out.
function toggleProfileMenu() {
    const menu = document.getElementById("mob-profile-menu");
    if (!menu) return;
    if (menu.style.display === "block") {
        closeProfileMenu();
    } else {
        populateProfileMenu();
        menu.style.display = "block";
        setTimeout(() => document.addEventListener("click", handleProfileMenuOutsideClick), 0);
    }
}

function closeProfileMenu() {
    const menu = document.getElementById("mob-profile-menu");
    if (menu) menu.style.display = "none";
    document.removeEventListener("click", handleProfileMenuOutsideClick);
}

function handleProfileMenuOutsideClick(e) {
    const menu = document.getElementById("mob-profile-menu");
    if (!menu || menu.contains(e.target)) return;
    closeProfileMenu();
}

function populateProfileMenu() {
    const user = mobSession && mobSession.user;
    const name = (user && (user.full_name || user.name)) || "Staff";
    setText("mob-profile-name", name);
    const role = (user && user.role) || "";
    setText("mob-profile-role", role ? role.replace(/_/g, " ").toLowerCase() : "—");

    const branchRow = document.getElementById("mob-profile-branch-row");
    if (!branchRow) return;
    const isSuperAdmin = role === "SUPER_ADMIN";
    branchRow.style.display = isSuperAdmin ? "block" : "none";
    if (isSuperAdmin) {
        const sel = document.getElementById("mob-branch-select");
        if (sel) sel.value = currentBranch;
    }
}

// ── 3. Initialization ───────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
    if (!checkDeviceGuard()) return;

    const stored = loadStoredSession();
    if (stored && stored.token) {
        mobSession = stored;
        // Verify the token is still valid server-side before trusting it
        // (it may have expired since the phone was last opened).
        try {
            const { ok, data } = await apiFetch("/resolve");
            if (ok && data.success) {
                mobSession.user = data.user;
                await showAppScreen();
                return;
            }
        } catch {
            // apiFetch already routed us to the login screen on 401
            return;
        }
    }
    showLoginScreen();
});

// ── 4. Login / 2FA / Logout ──────────────────────────────────────────
// Sequence: /login (password) -> either straight in (device already
// trusted), or a pending_token + one of totp_setup_required/totp_required
// -> submitMobTotpSetup / submitMobTotpVerify finishes the job and hands
// back the same {success, session_token, user} shape /login's direct
// success path would have returned.
async function submitMobLogin(e) {
    e.preventDefault();
    const userId = document.getElementById("mob-login-userid").value.trim();
    const password = document.getElementById("mob-login-password").value;
    const submitBtn = document.getElementById("mob-login-submit");
    const errEl = document.getElementById("mob-login-error");
    errEl.style.display = "none";

    if (!userId) return;
    submitBtn.disabled = true;
    submitBtn.textContent = "Logging in...";
    try {
        const deviceToken = loadStoredDeviceToken();
        const { data } = await apiFetch("/login", {
            method: "POST",
            body: { user_id: userId, password, device_token: deviceToken },
            auth: false,
        });

        if (data.status === "totp_setup_required") {
            pendingTotpToken = data.pending_token;
            await beginMobTotpSetup();
            return;
        }
        if (data.status === "totp_required") {
            pendingTotpToken = data.pending_token;
            showTotpVerifyScreen();
            return;
        }
        if (!data.success) {
            errEl.textContent = data.message || "Login failed.";
            errEl.style.display = "block";
            return;
        }

        saveMobSession({ token: data.session_token, user: data.user });
        document.getElementById("mob-login-form").reset();
        await showAppScreen();
    } catch (err) {
        errEl.textContent = "Could not reach the server. Please try again.";
        errEl.style.display = "block";
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Log In';
    }
}

// Fetches the QR/secret for a brand-new TOTP setup right after /login says
// this account has none confirmed yet.
async function beginMobTotpSetup() {
    try {
        const { data } = await totpFetch("/totp/setup");
        if (!data.success) {
            showLoginScreen(data.message || "Could not start 2FA setup. Please try again.");
            return;
        }
        showTotpSetupScreen(data.secret, data.otpauth_uri);
    } catch {
        showLoginScreen("Could not reach the server. Please try again.");
    }
}

async function submitMobTotpSetup(e) {
    e.preventDefault();
    const code = document.getElementById("mob-totp-setup-code").value.trim();
    const submitBtn = document.getElementById("mob-totp-setup-submit");
    const errEl = document.getElementById("mob-totp-setup-error");
    errEl.style.display = "none";

    submitBtn.disabled = true;
    submitBtn.textContent = "Verifying...";
    try {
        // trust_device: true — the device completing first-time setup IS
        // the device being registered, per the "bank app" model requested:
        // password + TOTP together is the registration event.
        const { data } = await totpFetch("/totp/verify-setup", { code, trust_device: true });
        if (!data.success) {
            errEl.textContent = data.message || "Incorrect code.";
            errEl.style.display = "block";
            return;
        }
        finishMobTotpLogin(data);
    } catch {
        errEl.textContent = "Could not reach the server. Please try again.";
        errEl.style.display = "block";
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-link"></i> Verify &amp; Link Device';
    }
}

async function submitMobTotpVerify(e) {
    e.preventDefault();
    const code = document.getElementById("mob-totp-verify-code").value.trim();
    const submitBtn = document.getElementById("mob-totp-verify-submit");
    const errEl = document.getElementById("mob-totp-verify-error");
    errEl.style.display = "none";

    submitBtn.disabled = true;
    submitBtn.textContent = "Verifying...";
    try {
        const { data } = await totpFetch("/totp/verify", { code, trust_device: true });
        if (!data.success) {
            errEl.textContent = data.message || "Incorrect code.";
            errEl.style.display = "block";
            return;
        }
        finishMobTotpLogin(data);
    } catch {
        errEl.textContent = "Could not reach the server. Please try again.";
        errEl.style.display = "block";
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-check"></i> Verify';
    }
}

function finishMobTotpLogin(data) {
    pendingTotpToken = null;
    if (data.device_token) saveDeviceToken(data.device_token);
    saveMobSession({ token: data.session_token, user: data.user });
    document.getElementById("mob-totp-setup-form").reset();
    document.getElementById("mob-totp-verify-form").reset();
    showAppScreen();
}

function logoutMob() {
    clearMobSession();
    // Deliberately NOT clearing the device token here — logging out and
    // back in on the same phone shouldn't force a fresh TOTP prompt. Only
    // an admin revoking this device (Admin Console) should do that.
    showLoginScreen();
}

// ── 5. Branch Change Handler ─────────────────────────────────────────
async function onMobBranchChange(branchCode) {
    currentBranch = branchCode;
    closeProfileMenu(); // branch switcher now lives in the profile menu
    await loadMobMasterlist();
    await loadMobDashboardStats();
    const bincardSelect = document.getElementById("mob-bincard-sku-select");
    if (bincardSelect && bincardSelect.value) {
        loadMobBinCard(bincardSelect.value);
    }
}

// ── 6. Tab Navigation Switcher ───────────────────────────────────────
// The top horizontal sub-tabs bar is gone — the bottom nav is now the
// only navigation, so this only needs to touch panels + bottom nav items.
// IMPORTANT: scope the nav-item lookup to .mobile-bottom-nav specifically.
// A bare ".nav-item" query used to also match the old header logout
// button (it shared the same class), which shifted every active-state
// index off by one — e.g. clicking "Home" would highlight the logout
// icon instead of the actual Home button. The logout button now lives in
// the profile menu with its own class, but scoping here defensively
// prevents this exact class-collision bug from recurring.
function switchMobTab(tabName) {
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));

    const targetPanel = document.getElementById(`panel-${tabName}`);
    if (targetPanel) targetPanel.classList.add("active");

    const tabsMap = { dash: 0, masterlist: 1, bincard: 2, receive: 3, transfer: 4 };
    const tabIdx = tabsMap[tabName] || 0;

    const bottomNavBtns = document.querySelectorAll(".mobile-bottom-nav .nav-item");
    bottomNavBtns.forEach((n) => n.classList.remove("active"));
    if (bottomNavBtns[tabIdx]) bottomNavBtns[tabIdx].classList.add("active");

    window.scrollTo({ top: 0, behavior: "smooth" });
}

// ── 7. Masterlist Loader ─────────────────────────────────────────────
async function loadMobMasterlist() {
    try {
        const { ok, data } = await apiFetch(`/masterlist?branch_code=${encodeURIComponent(currentBranch)}`);
        if (!ok) throw new Error(data.message || "Failed to load masterlist.");
        masterlistData = Array.isArray(data) ? data : [];

        renderMobMasterlist(masterlistData);
        populateProductDropdowns(masterlistData);
    } catch (e) {
        console.error("Error loading masterlist:", e);
        const tbody = document.getElementById("mob-masterlist-tbody");
        if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--red-alert);">Error loading data: ${escapeHtml(e.message)}</td></tr>`;
    }
}

function renderMobMasterlist(items) {
    const tbody = document.getElementById("mob-masterlist-tbody");
    if (!items || items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No products found</td></tr>`;
        return;
    }

    tbody.innerHTML = items.map((p) => {
        const packSize = p.pack_size || 1;
        const boxPrice = parseFloat(p.selling_price || 0);
        const pricePerTab = packSize > 0 ? boxPrice / packSize : boxPrice;
        // app_balance is in BOX units (same convention as the desktop
        // masterlist / bin card — see get_store_products()).
        const qtyOnHandBox = p.app_balance || 0;
        const totalCostEst = qtyOnHandBox * boxPrice;

        return `
            <tr>
                <td><strong style="color:var(--primary-blue);">${escapeHtml(p.sku)}</strong></td>
                <td style="max-width: 140px; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(p.name)}</td>
                <td style="text-align:center; font-weight:700;">${qtyOnHandBox}</td>
                <td><span class="price-tag-box">RM ${boxPrice.toFixed(2)}</span></td>
                <td><span class="price-tag-tab">RM ${pricePerTab.toFixed(2)}</span></td>
                <td>RM ${totalCostEst.toFixed(2)}</td>
                <td>
                    <button class="tab-btn-sm" style="padding:2px 8px; font-size:10px; background:var(--primary-blue);" onclick="openItemBinCard('${escapeHtml(p.sku)}')">
                        <i class="fa-solid fa-eye"></i> Ledger
                    </button>
                </td>
            </tr>
        `;
    }).join("");
}

function filterMobMasterlist() {
    const query = (document.getElementById("mob-search-input").value || "").toLowerCase().trim();
    const cat = document.getElementById("mob-cat-select").value;

    const filtered = masterlistData.filter((p) => {
        const matchesQuery = !query || (p.sku || "").toLowerCase().includes(query) || (p.name || "").toLowerCase().includes(query);
        const matchesCat = cat === "ALL" || (p.category && p.category.toUpperCase() === cat);
        return matchesQuery && matchesCat;
    });

    renderMobMasterlist(filtered);
}

function populateProductDropdowns(prods) {
    const bincardSel = document.getElementById("mob-bincard-sku-select");
    const rcvSel = document.getElementById("mob-rcv-sku");
    const trfSel = document.getElementById("mob-trf-sku");

    const optionsHtml = '<option value="">-- Select Product --</option>' +
        prods.map((p) => `<option value="${escapeHtml(p.sku)}">${escapeHtml(p.sku)} - ${escapeHtml(p.name)}</option>`).join("");

    if (bincardSel) bincardSel.innerHTML = optionsHtml;
    if (rcvSel) rcvSel.innerHTML = optionsHtml;
    if (trfSel) trfSel.innerHTML = optionsHtml;
}

function loadMobBinCardDropdown() {
    // masterlist load already populates the dropdown; kept as a
    // separate no-op entry point so DOMContentLoaded's call sequence
    // reads the same as it always has.
}

function openItemBinCard(sku) {
    const bincardSel = document.getElementById("mob-bincard-sku-select");
    if (bincardSel) bincardSel.value = sku;
    switchMobTab("bincard");
    loadMobBinCard(sku);
}

// ── 8. Bin Card Ledger Loader ──────────────────────────────────────────
// Markup mirrors the desktop app's Stock Control Card exactly (grouped
// PARTICULARS/REMARKS header, MFG + EXPIRY columns the old mobile table
// didn't show at all) — see index.html #panel-bincard.
async function loadMobBinCard(sku) {
    if (!sku) {
        document.getElementById("mob-bin-name").textContent = "SELECT AN ITEM TO VIEW";
        document.getElementById("mob-bin-sku").textContent = "-";
        document.getElementById("mob-bin-price").textContent = "-";
        document.getElementById("mob-bin-pack").textContent = "-";
        document.getElementById("mob-bincard-tbody").innerHTML = `<tr><td colspan="11" class="dt-empty">Select a product above to load its transaction history ledger.</td></tr>`;
        return;
    }

    try {
        const { ok, data } = await apiFetch(`/bincard?sku=${encodeURIComponent(sku)}&branch_code=${encodeURIComponent(currentBranch)}`);
        if (!ok || data.error) throw new Error(data.error || "Failed to load bin card.");

        document.getElementById("mob-bin-name").textContent = (data.name || "").toUpperCase();
        document.getElementById("mob-bin-sku").textContent = data.sku || sku;
        document.getElementById("mob-bin-pack").textContent = data.pack_size || 1;
        document.getElementById("mob-bin-price").textContent = parseFloat(data.selling_price || 0).toFixed(2);

        const rows = data.ledger || [];
        const tbody = document.getElementById("mob-bincard-tbody");
        if (rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="11" class="dt-empty">No ledger movements recorded for this item</td></tr>`;
        } else {
            tbody.innerHTML = rows.map((r) => `
                <tr>
                    <td>${r.no}</td>
                    <td>${escapeHtml(r.date)}</td>
                    <td>${escapeHtml(r.po || "-")}</td>
                    <td>${escapeHtml(r.inv || "-")}</td>
                    <td class="dt-in">${r.in || "-"}</td>
                    <td class="dt-out">${r.out || "-"}</td>
                    <td><strong>${r.bal}</strong></td>
                    <td>${escapeHtml(r.batch || "-")}</td>
                    <td>${escapeHtml(r.mfg || "-")}</td>
                    <td>${escapeHtml(r.expiry || "-")}</td>
                    <td>${escapeHtml((r.staff || "SYSTEM").toUpperCase())}</td>
                </tr>
            `).join("");
        }
    } catch (e) {
        console.error("Error loading bin card:", e);
        document.getElementById("mob-bincard-tbody").innerHTML = `<tr><td colspan="11" class="dt-empty" style="color:var(--red-alert);">Error loading ledger: ${escapeHtml(e.message)}</td></tr>`;
    }
}

// ── 9. Dashboard Stats & Chart Loader ───────────────────────────────────
// 1:1 port of the desktop "Store Metrics Dashboard" (src/web/
// store_portal.html view-dashboard + store_portal.js renderInventoryFlow-
// Chart) — same 5 KPI fields, same panel sections, same mixed bar+line
// chart config. All fields below already exist in get_store_dashboard_
// stats()'s response (cloudflare/store-api/src/routes/dashboard.js) —
// this only changes how the mobile page RENDERS them, not the backend.
async function loadMobDashboardStats() {
    try {
        const { ok, data } = await apiFetch(`/dashboard?branch_code=${encodeURIComponent(currentBranch)}`);
        if (!ok || data.error) throw new Error(data.error || "Failed to load dashboard.");

        const branchLabelEl = document.getElementById("dt-dash-branch");
        if (branchLabelEl) branchLabelEl.textContent = currentBranch;

        setText("dt-stat-total-item", data.total_items);
        setText("dt-stat-out-stock", data.out_of_stock);
        setText("dt-stat-total-in", data.total_in);
        setText("dt-stat-total-out", data.total_out);
        setText("dt-stat-remaining", data.remaining_stock);

        renderKpiTrend("dt-trend-total-in", computeMonthTrend(data.chart_in || []));
        renderKpiTrend("dt-trend-total-out", computeMonthTrend(data.chart_out || []));

        dashOutOfStockData = data.out_of_stock_list || [];
        dashExpiringSoonData = data.expiring_soon || [];
        const outstockSearchEl = document.getElementById("dt-outstock-search");
        const expiringSearchEl = document.getElementById("dt-expiring-search");
        if (outstockSearchEl) outstockSearchEl.value = "";
        if (expiringSearchEl) expiringSearchEl.value = "";
        renderDashOutOfStock(dashOutOfStockData);
        renderDashExpiring(dashExpiringSoonData);

        renderDtTable("mob-dash-transfers-tbody", data.transfer_summary, 4, "No recent transfers", (t) => `
            <tr>
                <td>${escapeHtml(formatDestShortform(t.destination))}</td>
                <td class="dt-tc">${t.in_transit || 0}</td>
                <td class="dt-tc">${t.received || 0}</td>
                <td class="dt-tc">${t.pending || 0}</td>
            </tr>
        `);

        dashFastMovingData = data.fast_moving || [];
        dashSlowMovingData = data.slow_moving || [];
        dashRecentMovementsData = data.recent_movements || [];
        renderDashMovementsTab();

        renderDashAlerts(data);
        renderDashMiniStats(data);
        renderMobChart(data.chart_labels || [], data.chart_in || [], data.chart_out || []);
    } catch (e) {
        console.error("Error loading dashboard stats:", e);
    }
}

// ── Out of Stock / Expiring Soon — icon-row lists + client-side search ──
function renderIconList(containerId, list, emptyMsg, rowFn) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const rows = list || [];
    if (rows.length === 0) {
        el.innerHTML = `<div class="dt-empty">${escapeHtml(emptyMsg)}</div>`;
        return;
    }
    el.innerHTML = rows.map(rowFn).join("");
}

function renderDashOutOfStock(list, hasQuery) {
    const emptyMsg = hasQuery ? "No matching items found" : "All items in stock";
    renderIconList("mob-dash-outstock-list", list, emptyMsg, (p) => `
        <div class="dt-icon-row">
            <span class="dt-icon-row-icon red"><i class="fa-solid fa-circle-exclamation"></i></span>
            <div class="dt-icon-row-body">
                <div class="dt-icon-row-title">${escapeHtml(p.name)}</div>
                <div class="dt-icon-row-sub">SKU: ${escapeHtml(p.sku)}</div>
            </div>
            <i class="fa-solid fa-chevron-right dt-icon-row-chevron"></i>
        </div>
    `);
    setText("dt-outstock-count", `${list.length} item${list.length === 1 ? "" : "s"}`);
}

function renderDashExpiring(list, hasQuery) {
    const emptyMsg = hasQuery ? "No matching items found" : "No items expiring within 90 days";
    renderIconList("mob-dash-expiring-list", list, emptyMsg, (p) => `
        <div class="dt-icon-row">
            <span class="dt-icon-row-icon orange"><i class="fa-solid fa-calendar-days"></i></span>
            <div class="dt-icon-row-body">
                <div class="dt-icon-row-title">${escapeHtml(p.name)}</div>
                <div class="dt-icon-row-sub">EXP: ${escapeHtml(p.expiry_date)}</div>
            </div>
            <span class="dt-days-left-badge">${p.days_left}d left</span>
        </div>
    `);
    setText("dt-expiring-count", `${list.length} item${list.length === 1 ? "" : "s"}`);
}

// which: "outstock" | "expiring" — mirrors filterMobMasterlist()'s pattern
// of filtering an in-memory array already fetched with the dashboard.
function filterDashList(which) {
    const inputId = which === "outstock" ? "dt-outstock-search" : "dt-expiring-search";
    const query = (document.getElementById(inputId).value || "").toLowerCase().trim();
    const source = which === "outstock" ? dashOutOfStockData : dashExpiringSoonData;
    const filtered = !query ? source : source.filter((p) =>
        (p.sku || "").toLowerCase().includes(query) || (p.name || "").toLowerCase().includes(query)
    );
    if (which === "outstock") renderDashOutOfStock(filtered, !!query);
    else renderDashExpiring(filtered, !!query);
}

// ── Fast Moving / Slow Moving / Recent Movements — segmented tab switcher ──
let dashFastMovingData = [];
let dashSlowMovingData = [];
let dashRecentMovementsData = [];

function switchDashMovementsTab(tab) {
    dashMovementsTab = tab;
    document.querySelectorAll(".dt-seg-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    renderDashMovementsTab();
}

function renderDashMovementsTab() {
    const titleEl = document.getElementById("dt-movements-title");
    const badgeEl = document.getElementById("dt-movements-badge");
    if (dashMovementsTab === "fast") {
        if (titleEl) titleEl.textContent = "Fast Moving Items";
        if (badgeEl) badgeEl.textContent = "(Top 10)";
        renderDtTable("dt-movements-tbody", dashFastMovingData, 3, "No movement data yet", (p, i) => `
            <tr>
                <td><span class="dt-rank-badge">${i + 1}</span></td>
                <td>${escapeHtml(p.name)}</td>
                <td class="dt-tr">${p.total_qty}</td>
            </tr>
        `);
        setMovementsHeader([
            { label: "#", style: "width:36px;" },
            { label: "ITEM NAME" },
            { label: "QTY OUT (30D)", cls: "dt-tr" },
        ]);
    } else if (dashMovementsTab === "slow") {
        if (titleEl) titleEl.textContent = "Slow Moving Items";
        if (badgeEl) badgeEl.textContent = "(Top 10)";
        renderDtTable("dt-movements-tbody", dashSlowMovingData, 3, "No movement data yet", (p, i) => `
            <tr>
                <td><span class="dt-rank-badge">${i + 1}</span></td>
                <td>${escapeHtml(p.name)}</td>
                <td class="dt-tr">${p.total_qty}</td>
            </tr>
        `);
        setMovementsHeader([
            { label: "#", style: "width:36px;" },
            { label: "ITEM NAME" },
            { label: "QTY OUT (90D)", cls: "dt-tr" },
        ]);
    } else {
        if (titleEl) titleEl.textContent = "Recent Movements";
        if (badgeEl) badgeEl.textContent = "(Last 10)";
        renderDtTable("dt-movements-tbody", dashRecentMovementsData, 4, "No recent movements", (m) => {
            const isIn = m.direction === "IN";
            return `
                <tr>
                    <td>${escapeHtml(m.name)}</td>
                    <td style="color:var(--dt-text-muted); font-size:10px;">${escapeHtml(m.performed_at || "-")}</td>
                    <td class="dt-tc">${escapeHtml((m.movement_type || "").replace(/_/g, " "))}</td>
                    <td class="dt-tr" style="color:${isIn ? "var(--dt-success)" : "var(--dt-danger)"}; font-weight:700;">${isIn ? "+" : "-"}${m.qty}</td>
                </tr>
            `;
        });
        setMovementsHeader([
            { label: "ITEM NAME" },
            { label: "WHEN", cls: "dt-tc" },
            { label: "TYPE", cls: "dt-tc" },
            { label: "QTY", cls: "dt-tr" },
        ]);
    }
}

function setMovementsHeader(cols) {
    const theadRow = document.getElementById("dt-movements-thead");
    if (!theadRow) return;
    theadRow.innerHTML = cols.map((c) =>
        `<th${c.style ? ` style="${c.style}"` : ""}${c.cls ? ` class="${c.cls}"` : ""}>${escapeHtml(c.label)}</th>`
    ).join("");
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value == null ? "—" : value;
}

// Real "vs last month" trend for Total Stock In/Out — the only 2 of the 5
// KPI cards where a truthful month-over-month comparison is possible
// without new backend infrastructure: chart_in/chart_out are genuine
// monthly totals for the CURRENT year (Jan-index 0 .. Dec-index 11)
// already returned by /dashboard. Total Stock Item / Out of Stock /
// Remaining Stock are point-in-time snapshot counts with no history
// captured anywhere, so a "+X% vs last month" badge for those would have
// to be fabricated — deliberately not done here (see task #35: KPI cards
// must never show mock/fake numbers). In January there is no prior month
// inside this same Jan-Dec array (December belongs to the previous year's
// data, which this endpoint doesn't return), so trend is skipped that
// month and the static fallback text in the HTML is left as-is.
function computeMonthTrend(seriesArr) {
    const monthIdx = new Date().getMonth(); // 0 = Jan
    if (monthIdx === 0) return null;
    const current = seriesArr[monthIdx] || 0;
    const prev = seriesArr[monthIdx - 1] || 0;
    if (prev > 0) return Math.round(((current - prev) / prev) * 1000) / 10;
    return current > 0 ? 100 : 0;
}

function renderKpiTrend(id, pct) {
    if (pct == null) return; // leave the static fallback text untouched
    const el = document.getElementById(id);
    if (!el) return;
    const arrow = pct >= 0 ? "▲" : "▼";
    const sign = pct >= 0 ? "+" : "";
    el.textContent = `${arrow} ${sign}${pct}% vs last month`;
    el.style.color = pct >= 0 ? "var(--dt-success)" : "var(--dt-danger)";
}

// Shared table-body renderer for every dashboard panel — desktop's
// backend already returns these lists pre-sorted/pre-limited (fast_moving/
// slow_moving to top 10, expiring_soon to 30), so this just maps rows to
// markup and shows a friendly empty-state row otherwise.
function renderDtTable(tbodyId, list, colspan, emptyMsg, rowFn) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    const rows = list || [];
    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${colspan}" class="dt-empty">${escapeHtml(emptyMsg)}</td></tr>`;
        return;
    }
    tbody.innerHTML = rows.map(rowFn).join("");
}

// Synthesized from the same stats every other panel uses — the desktop
// app's exact alert-generation rule set lives in store_portal.js and
// wasn't ported field-for-field; this covers the same real conditions
// (out-of-stock count, items expiring soon, VIMS sync health) a pharmacy
// staff member actually needs surfaced.
function renderDashAlerts(data) {
    const list = document.getElementById("dash-alerts-list");
    if (!list) return;
    const alerts = [];

    if ((data.out_of_stock || 0) > 0) {
        alerts.push({ icon: "⚠️", pill: "red", title: "Out of Stock Alerts", desc: "Items need immediate attention", count: data.out_of_stock });
    }
    if ((data.expiring_soon || []).length > 0) {
        alerts.push({ icon: "⏳", pill: "orange", title: "Expiring Soon", desc: "Items expiring within 90 days", count: data.expiring_soon.length });
    }
    if (data.sync_online === false) {
        alerts.push({ icon: "🔄", pill: "yellow", title: "VIMS Sync Offline", desc: data.last_sync_label || "Never synced", count: null });
    }

    // Header bell badge — same real alert count computed above, not a
    // separate/fake notification counter.
    renderHeaderNotifBadge(alerts.length);

    if (alerts.length === 0) {
        list.innerHTML = `<div class="dt-empty">No active alerts</div>`;
        return;
    }

    list.innerHTML = alerts.map((a) => `
        <div class="dt-alert-row">
            <div class="dt-alert-left">
                <span class="dt-alert-icon-pill ${a.pill}">${a.icon}</span>
                <div>
                    <div class="dt-alert-title">${escapeHtml(a.title)}</div>
                    <div class="dt-alert-desc">${escapeHtml(a.desc)}</div>
                </div>
            </div>
            ${a.count != null ? `<span class="dt-alert-count">${a.count}</span>` : ""}
        </div>
    `).join("");
}

function renderDashMiniStats(data) {
    setText("mini-total-products", data.total_items);
    setText("mini-total-categories", data.total_categories);
    setText("mini-total-suppliers", data.total_suppliers);
    setText("mini-stock-value", `RM ${Number(data.stock_value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    setText("mini-transactions", data.transactions_30d);
    const pctEl = document.getElementById("mini-transactions-pct");
    if (pctEl) {
        const pct = data.transactions_30d_pct_change;
        if (pct == null) {
            pctEl.textContent = "";
        } else {
            pctEl.textContent = `${pct >= 0 ? "↑" : "↓"} ${Math.abs(pct)}% vs last month`;
            pctEl.style.color = pct >= 0 ? "var(--dt-success)" : "var(--dt-danger)";
        }
    }
    if (data.last_ledger_update) {
        const daysAgo = data.last_ledger_days_ago;
        setText("mini-last-ledger", daysAgo === 0 ? "Today" : `${data.last_ledger_update} (${daysAgo}d ago)`);
    } else {
        setText("mini-last-ledger", "No data");
    }
    setText("mini-sync-status", data.sync_online ? "Online" : (data.last_sync_label || "Offline"));
}

// Mixed bar+line config — matches desktop's renderInventoryFlowChart()
// (store_portal.js) exactly: Net Flow as a line dataset drawn over Stock
// In / Stock Out bars, Net Flow computed client-side as in-minus-out per
// month (backend only sends the two raw series).
function renderMobChart(labels, dataIn, dataOut) {
    const ctx = document.getElementById("mob-chart-trends");
    if (!ctx) return;

    const netFlow = (dataIn || []).map((v, i) => (v || 0) - ((dataOut || [])[i] || 0));

    if (movementChart) movementChart.destroy();

    movementChart = new Chart(ctx, {
        data: {
            labels: labels.length ? labels : ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
            datasets: [
                { type: "line", label: "Net Flow", data: netFlow, borderColor: "#8b5cf6", borderWidth: 2.5, tension: 0.35, pointBackgroundColor: "#8b5cf6", pointRadius: 3, order: 1 },
                { type: "bar", label: "Stock In", data: dataIn, backgroundColor: "#10b981", borderRadius: 4, barPercentage: 0.5, categoryPercentage: 0.7, order: 2 },
                { type: "bar", label: "Stock Out", data: dataOut, backgroundColor: "#f97316", borderRadius: 4, barPercentage: 0.5, categoryPercentage: 0.7, order: 3 },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { backgroundColor: "#0f172a", padding: 10, cornerRadius: 8 },
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: "#8b949e", font: { size: 9 } } },
                y: { beginAtZero: true, grid: { color: "#21262d" }, ticks: { color: "#8b949e", font: { size: 9 }, callback: (v) => Number(v).toLocaleString() } },
            },
        },
    });
}

// ── 10. Form Submit Handlers ──────────────────────────────────────────
async function submitMobReceive(e) {
    e.preventDefault();
    const po = document.getElementById("mob-rcv-po").value.trim();
    const sku = document.getElementById("mob-rcv-sku").value;
    const qty = parseInt(document.getElementById("mob-rcv-qty").value, 10);
    const batch = document.getElementById("mob-rcv-batch").value.trim();
    const exp = document.getElementById("mob-rcv-exp").value;

    if (!sku || !qty) return alert("Please select an item and enter quantity.");

    try {
        const { ok, data } = await apiFetch("/receive", {
            method: "POST",
            body: {
                branch_code: currentBranch,
                notes: "",
                items: [{ sku, qty_received: qty, batch_no: batch, expiry_date: exp, po_ref: po }],
            },
        });
        if (!ok || !data.success) throw new Error(data.message || "Failed to post receive.");

        alert(`✅ Stock receive posted (${data.receipt_no}).`);
        document.getElementById("mob-receive-form").reset();
        await loadMobMasterlist();
        switchMobTab("masterlist");
    } catch (err) {
        alert("❌ Failed to submit receive: " + err.message);
    }
}

async function submitMobTransfer(e) {
    e.preventDefault();
    const dest = document.getElementById("mob-trf-dest").value;
    const sku = document.getElementById("mob-trf-sku").value;
    const qty = parseInt(document.getElementById("mob-trf-qty").value, 10);

    if (!sku || !qty) return alert("Please select an item and enter quantity.");

    try {
        const { ok, data } = await apiFetch("/transfer", {
            method: "POST",
            body: {
                branch_code: currentBranch,
                target_location_code: dest,
                lines: [{ sku, qty }],
            },
        });
        if (!ok || !data.success) throw new Error(data.message || "Failed to process transfer.");

        alert(`✅ Stock transfer to ${dest} processed successfully!`);
        document.getElementById("mob-transfer-form").reset();
        await loadMobMasterlist();
        switchMobTab("dash");
    } catch (err) {
        alert("❌ Failed to submit transfer: " + err.message);
    }
}
