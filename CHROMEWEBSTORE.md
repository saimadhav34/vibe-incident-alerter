# Chrome Web Store & Edge Add-ons Listing — Vibe Incident Email Alerter

> Last Updated: 2026-10-26

## Store Listing

**Extension Name** [REQUIRED]
Vibe Incident Email Alerter

**Short Description** [REQUIRED]
Triggers a continuous sound alarm, desktop notification, and in-page alert banner when a Vibe incident email arrives in Outlook or Gmail.

**Detailed Description** [REQUIRED]
Never miss a critical Vibe incident email again. Vibe Incident Email Alerter monitors your open Outlook Web or Gmail inbox and immediately triggers an unmistakable audio alarm, desktop notification, and flashing in-page alert banner the moment a matching incident email arrives.

Key Features:
Instant Audio Alarm: Choose from four distinct high-priority alarm tones (Urgent Two-Tone Siren, Incident Pager Beep, High-Priority Triad Chime, or Sonar Radar Pulse) that loop continuously until you acknowledge the alert.
Multi-Channel Visual Alerts: Displays a persistent system desktop notification and a prominent red alert banner right inside your webmail tab, plus highlights and scrolls to the exact email in your inbox.
Customizable Matching Rules: Pre-configured to detect "vibe" and "incident" emails out of the box. Easily add or remove keywords, switch between matching all keywords or any keyword, and filter by specific sender addresses or domains.
Works Across Outlook Web and Gmail: Supports Microsoft 365 Outlook Web, Outlook Live, and Google Mail on both Microsoft Edge and Google Chrome.
One-Click Simulation: Test your volume, sound profile, and notification setup anytime directly from the extension popup.

How to Use:
1. Pin Vibe Incident Email Alerter to your Microsoft Edge or Google Chrome toolbar.
2. Open the extension popup to review your keywords (defaults to "vibe" and "incident") and choose your preferred alarm sound and volume.
3. Click "Simulate Vibe Incident Alert Now" to test the alarm and click "Acknowledge & Stop Sound" to silence it.
4. Keep your Outlook Web or Gmail tab open; the extension will automatically alert you when a matching unread email arrives.

Privacy & Permissions:
All email matching happens locally inside your browser. No email content, sender information, or personal data is ever transmitted to external servers.

**Category** [REQUIRED]
Productivity

**Single Purpose** [REQUIRED]
Alerts users with a sound alarm, desktop notification, and in-page banner when incoming webmail messages in Outlook Web or Gmail match configured incident keywords.

**Primary Language** [REQUIRED]
English

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `icons/icon-128.png` |
| Screenshot 1 [REQUIRED] | 1280×800 or 640×400 | ⬜ Not created | |
| Screenshot 2 [RECOMMENDED] | 1280×800 or 640×400 | ⬜ Not created | |

### Screenshot Notes
- Screenshot 1: Show the extension popup open alongside an Outlook Web / Gmail inbox with the red in-page Vibe Incident Alert banner active at the top.
- Screenshot 2: Show the keyword chips, match mode selector, and sound profile options inside the popup UI.

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `storage` | permissions | Saves user-configured incident keywords, sender filters, sound preferences, active alarm status, and recent incident history locally across browser sessions. |
| `notifications` | permissions | Displays high-priority desktop notifications with an "Acknowledge & Stop Alarm" button when a matching incident email is detected while the user is working in another window or application. |
| `offscreen` | permissions | Plays the continuous alarm sound in the background when a matching incident email arrives, even when the webmail tab is in the background. |
| `alarms` | permissions | Triggers a periodic 30-second background check to ensure open webmail tabs are scanned even when throttled in the background. |
| `tabs` | permissions | Locates open Outlook Web and Gmail tabs to trigger periodic scans and brings the relevant webmail tab into focus when the user clicks "Open Mail" on an incident alert. |
| `https://mail.google.com/*` | host_permissions | Scans visible inbox rows in Gmail locally to detect unread emails matching the user's incident keywords and displays the in-page alert banner. |
| `https://outlook.office.com/*` | host_permissions | Scans visible inbox rows in Microsoft 365 Outlook Web locally to detect unread emails matching the user's incident keywords and displays the in-page alert banner. |
| `https://outlook.office365.com/*` | host_permissions | Scans visible inbox rows in Office 365 enterprise Outlook Web locally to detect unread emails matching the user's incident keywords and displays the in-page alert banner. |
| `https://outlook.live.com/*` | host_permissions | Scans visible inbox rows in Outlook.com Web locally to detect unread emails matching the user's incident keywords and displays the in-page alert banner. |
| `https://outlook.cloud.microsoft/*` | host_permissions | Scans visible inbox rows in Outlook on cloud.microsoft locally to detect unread emails matching the user's incident keywords and displays the in-page alert banner. |

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL** [REQUIRED]
No user data or email content is collected, stored externally, or transmitted off-device. All keyword matching and settings storage occur strictly locally within the user's browser via `chrome.storage.local`.

## Distribution

**Visibility**: Public / Unlisted / Private
**Regions**: All regions

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.0.0 | 2026-10-26 | Initial release for Microsoft Edge and Google Chrome supporting Outlook Web and Gmail incident email alerts. | Draft |
