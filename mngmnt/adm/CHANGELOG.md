# Changelog

## [v10.2] - 2026-06-29

### Added
- **PING (Rich System Health Status):** Agent now returns critical system metrics (Uptime, CPU, RAM) instead of just 'EXECUTED'.
- **RESTART (Confirmation & Boot Duration):** Agent verifies successful restarts and reports boot duration.
- **GET_LOGS (Fetch Latest Error Logs):** Admin can retrieve the last 20 lines of the local error log directly from the device.
- **VERSION_CHECK (Check Agent & OS Version):** Gathers Agent version, OS details, and local IP.
- **CHECK_DISK (Storage Full Warning):** Alerts admin if the primary drive (C:) is running out of space.
- **SCREENSHOT (Remote Screen Capture):** Silently captures the target computer's screen and uploads it to Supabase Storage.
- **SPEED_TEST (Network Speed Test):** Performs internal ping, download, and upload tests to check network latency.
- **UPDATE_AGENT (Force Software Update):** Supports OTA (Over-The-Air) automatic updates forced by the admin console.
- **CLEAR_CACHE (System Cleanup):** Instructs the device to clear temporary files and logs to free up storage space.
- **RUN_SCRIPT (Execute Custom Scripts):** Executes CMD/PowerShell scripts remotely and returns the stdout.
- **PROACTIVE_ALERT (Automated Warnings):** Agent monitors CPU/RAM and automatically sends WARNING (90%) and CRITICAL (100%) alerts.
- **FETCH_FILE (Remote File Retrieval):** Fetches specific failed files or reports and uploads them for the admin to review.
- **CAPTURE_PUBLIC_IP (Capture Public IP & Geolocation):** Agent captures exact Public IP and Latitude/Longitude using ip-api.com to support the real-time Google Maps feature on the Device Profile.

### Fixed
- **UI:** Realigned `r-filter-bar` dropdowns to sit side-by-side with fixed equal widths.
- **UI:** Fixed CPU chart touch scrolling issue on iOS (iPhone) by adjusting `touch-action`.
- **UI:** Fixed map iframe escaping syntax bug in `app.js` device profile.

### Changed
- **UI:** Standardized character encoding (UTF-8) across `app.js` to replace legacy symbols.
- **UI:** Inserted Google Maps panel beside the Live Stream terminal in the Device Profile view.
