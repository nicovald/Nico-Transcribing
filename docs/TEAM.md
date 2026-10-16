# Team version (Vercel)

One shared copy of the transcriber at **https://transcriber.nicovald.dev**. Editors open the link, sign in with their Vercel account and use it in the browser. Nothing to install, and nothing is public: Vercel Authentication blocks anyone who isn't on the team.

## Invite an editor

1. Vercel → **Team Settings → Members → Invite**, enter their email, role **Viewer** (Pro Viewer seats are free).
2. They accept the email, create a free Vercel account if they don't have one, then open the link.

Remove access the same way. Anyone else who opens the link sees a Vercel sign-in page and can only *request* access, which you approve or decline under the project's **Deployment Protection → Requests**.

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
- Costs (Pro): sandbox time while awake (2 vCPU, 4 GB) is a few cents per video; Blob storage only holds uploads until they are imported. The $20 monthly Pro credit covers normal use.

## Settings on Vercel

| Variable | What it is |
| --- | --- |
| `PROXY_SECRET` | Shared secret between the proxy and the sandbox. Also signs audio links. Production and Preview. |
| `CRON_SECRET` | Lets only Vercel Cron call `/api/keepalive`. |
| `BLOB_READ_WRITE_TOKEN` | Added by connecting the private Blob store `nico-transcriber-uploads`. |
| `ELECTRON_SKIP_BINARY_DOWNLOAD=1` | Keeps builds from downloading Electron. |

Code: `api/` (Vercel functions), `server/cloud.js` (team-mode checks, used only when `PROXY_SECRET` is set), `vercel.json`. The desktop app and Docker never set `PROXY_SECRET`, so none of this affects them.
