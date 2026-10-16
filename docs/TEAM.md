# Team version (Vercel)

One shared copy of the transcriber at **https://transcriber.nicovald.dev**. Editors open the link, sign in with their own Vercel account and use it in the browser once Nico approves their access request. Nothing to install, and nothing is public: Vercel Authentication blocks everyone else.

## Give an editor access

1. Send them the link. They sign in with their own Vercel account (free to create) and click **Request Access**.
2. Approve it under the project's **Settings → Deployment Protection → Requests**. Revoke it under **Access**.

Editors are never invited to the Vercel team, not even as free Viewers: Pro Viewers can see every project on the team, and per-project roles are Enterprise-only. Anyone not approved only sees the Vercel sign-in page.

## Team rules (nicovald Vercel team)

- **No bypasses, ever.** No Protection Bypass for Automation keys (`vercel curl` creates one), Shareable Links or passwords, not even temporarily. Vercel Authentication stays on **All Deployments**. To test a protected deployment, ask Nico or test locally.
- **Preview storage is separate.** `BLOB_READ_WRITE_TOKEN` has two entries: Production uses `nico-transcriber-uploads`, Preview + Development use `nico-transcribing-preview`. Never point previews at the production store. Old preview builds keep the old token until they are redeployed.
- **Domains**: `transcriber.nicovald.dev` only. Never add nicovald.com to Vercel.
- **Deploys**: pushes to `main` go to production, other branches make previews. Delete throwaway projects, or tell Nico about them.
- **Spending**: the team budget is $10 of on-demand charges on top of the $20 Pro credit, with Pause on, so going over pauses **all** production sites. Don't add anything with recurring cost without telling Nico, and never change the budget.

## First-time setup (once)

- **Settings → Transcription**: paste the API keys. They are stored on the team's private drive, never sent to the browser in full, and shared by everyone.
- Learned fixes, term lists and presets are shared too.

## How it works

```
browser ──► transcriber.nicovald.dev  (Vercel Authentication)
              ├─ the page itself (static files)
              ├─ /api/upload-token   lets the browser upload one video into private Blob storage
              ├─ /api/keepalive      cron every 2 min: keeps the sandbox awake while it is working
              └─ /api/*  ──► proxy ──► Vercel Sandbox "transcriber-production"
                                         the normal app server (server/), unchanged
                                         /data = Drive "transcriber-data-production" (projects, audio, settings)
```

- **The sandbox sleeps when nobody uses it** (30 minutes after the last request, or after the last job finishes) and costs nothing while asleep. The first visit after that takes a few seconds while it wakes.
- **Uploads** go from the browser straight into private Blob storage in parts (any size), then the sandbox copies the video in, deletes it from storage, and pulls out the audio as usual. A 47-minute, 12 GB, 6-track recording took about 3 minutes to upload on a fast connection and 4½ minutes to extract.
- **Review audio** is streamed directly from the sandbox through short-lived signed links, because it is too large to pass through the proxy.
- **Deploys**: every push to `main` deploys. On the next request the sandbox fetches that exact commit and restarts, unless something is importing or transcribing, in which case it waits until that work is done.
- **Previews** (other branches) use their own sandbox and a small separate drive, so testing never touches the team's data.

## Limits and costs

- The data drive is 13 GiB, because Vercel currently limits this team's Drive storage to 15 GiB in total. That holds roughly 50 long multi-track projects of extracted audio. Delete old projects to free space. When Vercel lifts the limit, create a bigger drive and copy `/data` across.
- A single sandbox session lasts at most 24 hours; a transcription still running at that moment is marked "Interrupted, hit Retry", as in the desktop app.
- Costs (Pro): sandbox time while awake (2 vCPU, 4 GB) is a few cents per video; Blob storage only holds uploads until they are imported; the keep-awake cron is a tiny function call every 2 minutes. The $20 monthly Pro credit covers normal use. Remember the $10 on-demand budget pauses every production site when exceeded (see Team rules).

## Settings on Vercel

| Variable | What it is |
| --- | --- |
| `PROXY_SECRET` | Shared secret between the proxy and the sandbox. Also signs audio links. Production and Preview. |
| `CRON_SECRET` | Lets only Vercel Cron call `/api/keepalive`. |
| `BLOB_READ_WRITE_TOKEN` | Production: private store `nico-transcriber-uploads`. Preview + Development: `nico-transcribing-preview`. |
| `ELECTRON_SKIP_BINARY_DOWNLOAD=1` | Keeps builds from downloading Electron. |

Code: `api/` (Vercel functions), `server/cloud.js` (team-mode checks, used only when `PROXY_SECRET` is set), `vercel.json`. The desktop app and Docker never set `PROXY_SECRET`, so none of this affects them.
