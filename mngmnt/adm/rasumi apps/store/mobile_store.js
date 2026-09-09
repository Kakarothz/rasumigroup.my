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
    if (mobSession && mobSession.user && mobSession.user.home_branch_code) {
        currentBranch = mobSession.user.home_branch_code;
        const sel = document.getElementById("mob-branch-select");
        if (sel) sel.value = currentBranch;
    }
    await loadMobMasterlist();
    await loadMobDashboardStats();
    loadMobBinCardDropdown();
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
    await loadMobMasterlist();
    await loadMobDashboardStats();
    const bincardSelect = document.getElementById("mob-bincard-sku-select");
    if (bincardSelect && bincardSelect.value) {
        loadMobBinCard(bincardSelect.value);
    }
}

// ── 6. Tab Navigation Switcher ───────────────────────────────────────
function switchMobTab(tabName) {
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    document.querySelectorAll(".tab-btn-sm").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));

    const targetPanel = document.getElementById(`panel-${tabName}`);
    if (targetPanel) targetPanel.classList.add("active");

    const tabsMap = { dash: 0, masterlist: 1, bincard: 2, receive: 3, transfer: 4 };
    const tabIdx = tabsMap[tabName] || 0;

    const subTabBtns = document.querySelectorAll(".tab-btn-sm");
    if (subTabBtns[tabIdx]) subTabBtns[tabIdx].classList.add("active");

    const bottomNavBtns = document.querySelectorAll(".nav-item");
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

// ── 8. Bin Card Ledger Loader ────────────────────────────────────────
async function loadMobBinCard(sku) {
    if (!sku) {
        document.getElementById("mob-bincard-meta").style.display = "none";
        document.getElementById("mob-bincard-tbody").innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--text-muted);">Select a product to view ledger</td></tr>`;
        return;
    }

    try {
        const { ok, data } = await apiFetch(`/bincard?sku=${encodeURIComponent(sku)}&branch_code=${encodeURIComponent(currentBranch)}`);
        if (!ok || data.error) throw new Error(data.error || "Failed to load bin card.");

        document.getElementById("mob-bincard-meta").style.display = "block";
        document.getElementById("mob-bin-name").textContent = (data.name || "").toUpperCase();
        document.getElementById("mob-bin-sku").textContent = data.sku || sku;
        document.getElementById("mob-bin-pack").textContent = data.pack_size || 1;

        const boxPrice = parseFloat(data.selling_price || 0);
        const packSz = data.pack_size || 1;
        const tabPrice = packSz > 0 ? boxPrice / packSz : boxPrice;
        document.getElementById("mob-bin-price-box").textContent = `RM ${boxPrice.toFixed(2)}`;
        document.getElementById("mob-bin-price-tab").textContent = `RM ${tabPrice.toFixed(2)}`;

        const rows = data.ledger || [];
        const tbody = document.getElementById("mob-bincard-tbody");
        if (rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--text-muted);">No ledger movements recorded for this item</td></tr>`;
        } else {
            tbody.innerHTML = rows.map((r) => `
                <tr>
                    <td style="text-align:center;">${r.no}</td>
                    <td>${escapeHtml(r.date)}</td>
                    <td>${escapeHtml(r.po || "-")}</td>
                    <td>${escapeHtml(r.inv || "-")}</td>
                    <td style="text-align:center; color:#60a5fa; font-weight:700;">${r.in || "-"}</td>
                    <td style="text-align:center; color:#f87171; font-weight:700;">${r.out || "-"}</td>
                    <td style="text-align:center; font-weight:800;">${r.bal}</td>
                    <td>${escapeHtml(r.batch || "-")}</td>
                    <td>${escapeHtml((r.staff || "SYSTEM").toUpperCase())}</td>
                </tr>
            `).join("");
        }
    } catch (e) {
        console.error("Error loading bin card:", e);
        document.getElementById("mob-bincard-tbody").innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--red-alert);">Error loading ledger: ${escapeHtml(e.message)}</td></tr>`;
    }
}

// ── 9. Dashboard Stats & Chart Loader ─────────────────────────────────
async function loadMobDashboardStats() {
    try {
        const { ok, data } = await apiFetch(`/dashboard?branch_code=${encodeURIComponent(currentBranch)}`);
        if (!ok || data.error) throw new Error(data.error || "Failed to load dashboard.");

        document.getElementById("mob-stat-total-items").textContent = data.total_items;
        document.getElementById("mob-stat-stock-val").textContent = `RM ${(data.stock_value / 1000).toFixed(1)}k`;
        document.getElementById("mob-stat-low-stock").textContent = data.remaining_stock;
        document.getElementById("mob-stat-out-stock").textContent = data.out_of_stock;

        const outTbody = document.getElementById("mob-dash-outstock-tbody");
        const outList = data.out_of_stock_list || [];
        if (outList.length === 0) {
            outTbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--emerald-green);">All items in stock 👍</td></tr>`;
        } else {
            outTbody.innerHTML = outList.slice(0, 5).map((p) => `
                <tr>
                    <td><strong style="color:var(--primary-blue);">${escapeHtml(p.sku)}</strong></td>
                    <td>${escapeHtml(p.name)}</td>
                    <td>${escapeHtml(p.category || "General")}</td>
                    <td style="color:var(--text-muted); font-size:10px;">${escapeHtml(p.date || "-")}</td>
                </tr>
            `).join("");
        }

        const trfTbody = document.getElementById("mob-dash-transfers-tbody");
        const transferSummary = data.transfer_summary || [];
        if (transferSummary.length === 0) {
            trfTbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No recent transfers</td></tr>`;
        } else {
            trfTbody.innerHTML = transferSummary.slice(0, 5).map((t) => {
                const shortDest = formatDestShortform(t.destination);
                const totalEvents = (t.received || 0) + (t.pending || 0);
                const statusLabel = t.pending > 0 ? "Pending" : "Completed";
                const statusColor = t.pending > 0 ? "var(--amber-warn)" : "var(--emerald-green)";
                return `
                    <tr>
                        <td><strong>${totalEvents}x</strong></td>
                        <td><span class="price-tag-box" style="background:rgba(245,158,11,0.15); color:#fbbf24;">${escapeHtml(shortDest)}</span></td>
                        <td>${totalEvents} item(s)</td>
                        <td><span style="color:${statusColor}; font-weight:700;">${statusLabel}</span></td>
                    </tr>
                `;
            }).join("");
        }

        renderMobChart(data.chart_labels || [], data.chart_in || [], data.chart_out || []);
    } catch (e) {
        console.error("Error loading dashboard stats:", e);
    }
}

function renderMobChart(labels, dataIn, dataOut) {
    const ctx = document.getElementById("mob-chart-trends");
    if (!ctx) return;

    if (movementChart) movementChart.destroy();

    movementChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: labels.length ? labels : ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
            datasets: [
                { label: "Stock In", data: dataIn, borderColor: "#2563eb", backgroundColor: "rgba(37, 99, 235, 0.1)", fill: true, tension: 0.4 },
                { label: "Stock Out", data: dataOut, borderColor: "#ef4444", backgroundColor: "rgba(239, 68, 68, 0.1)", fill: true, tension: 0.4 },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: "#8b949e", font: { size: 10 } } } },
            scales: {
                x: { ticks: { color: "#6e7681", font: { size: 9 } }, grid: { color: "#21262d" } },
                y: { ticks: { color: "#6e7681", font: { size: 9 } }, grid: { color: "#21262d" } },
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
