# Vibe On-Call Email Alerter (Microsoft Edge & Google Chrome Extension)

A Manifest V3 browser extension for **Microsoft Edge** and **Google Chrome** that lets you attach your email account (**Outlook Web** or **Gmail**) and triggers an immediate continuous alarm when a **Vibe On-Call** paging email arrives with:
- `vibe on call`
- `you are being paged`
- `cibranium labs`

---

## What Happens When a Vibe On-Call Email Arrives
1. **Continuous Alarm Sound**: Loops in the background (*Urgent Two-Tone Siren*, *Incident Pager Beep*, *High-Priority Triad Chime*, or *Sonar / Radar Pulse*) until you click **Acknowledge & Stop Sound**.
2. **System Desktop Notification**: Pops up over any window with **🛑 Acknowledge & Stop Alarm** and **📬 Open Mail Tab** buttons.
3. **Flashing In-Page Alert Banner**: Appears at the top of your Outlook Web or Gmail tab and highlights the exact email row in your inbox.

---

## 1. Install in Microsoft Edge or Google Chrome

### Microsoft Edge
1. Download and extract `vibe-incident-alerter.zip` to a folder on your computer.
2. Open Edge and go to `edge://extensions`.
3. Turn **ON** **Developer mode** (left sidebar).
4. Click **Load unpacked** and select the extracted `vibe-incident-alerter` folder.
5. Click the **Extensions** puzzle icon in the Edge toolbar and pin **Vibe Incident Email Alerter**.

### Google Chrome
1. Download and extract `vibe-incident-alerter.zip` to a folder on your computer.
2. Open Chrome and go to `chrome://extensions`.
3. Turn **ON** **Developer mode** (top-right).
4. Click **Load unpacked** and select the extracted `vibe-incident-alerter` folder.
5. Pin **Vibe Incident Email Alerter** in your Chrome toolbar.

---

## 2. Attach Your Email & Test

1. Click the **V!** icon in your browser toolbar to open the popup.
2. Under **1. Attach Your Email Account**:
   - Enter your email address (e.g., `your.name@cibraniumlabs.com` or your Gmail/Outlook address).
   - Select your mail provider (**Auto-detect**, **Microsoft 365 Outlook Web**, **Outlook.com**, or **Gmail**).
   - Click **🔗 Attach & Open Mail** — the extension will open/focus your mailbox tab and display **🟢 Connected**.
3. Under **2. Vibe On-Call Keywords**, verify the pre-configured phrases:
   - `vibe on call`
   - `you are being paged`
   - `cibranium labs`
4. Click **🚨 Simulate Vibe On-Call Page Now** under **4. Test & Recent Pages** to test the full alarm and click **🛑 Acknowledge & Stop Sound** to silence it.
