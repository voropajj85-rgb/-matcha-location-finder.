# Preview Matcha Location Finder from another device

## Stable preview: iPhone on mobile internet

Open **https://voropajj85-rgb.github.io/-matcha-location-finder./** on the iPhone.
This existing GitHub Pages deployment serves merged `main` without requiring the
Windows PC to stay on. The final dot in the repository path is intentional.

The existing Pages workflow successfully deployed main commit
`40c84269c169e10ff84ba8f766b552fead640714`. No deployment settings or workflows
were changed for this helper. Subsequent merges to main use the existing Pages
deployment. Unmerged local edits require LAN access or a temporary tunnel.

## Local edits: same Wi-Fi/LAN

From this repository in PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\preview.ps1
```

The process-scoped execution-policy option does not change Windows' saved policy.
The helper uses installed Python 3, binds `0.0.0.0:4173`, and prints the current
LAN URL automatically. Open the printed **Same-WiFi/LAN only** URL on the phone
when it shares the PC's network. `localhost` is printed only for checking the PC;
it is not an address for another device.

Keep the terminal open; Ctrl+C stops its child server/tunnel. If the port is
occupied, the helper leaves the existing process alone. Choose a different port:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\preview.ps1 -Port 4174
```

The document root is resolved from the script location, independent of the
terminal's working directory. It is the repository root: `index.html` and
relative `js/`, `css/`, `data/`, `assets/` paths work. The standard-library server
blocks private files, `.git`, scripts/reports, directory listings and paths outside
public assets. It accepts read requests only. No local data edits are uploaded.

LAN access still depends on Windows Firewall and router/client isolation. If
Windows asks about Python, allow access only on the intended private network.
This helper does not change firewall rules or router settings. A LAN address
does not work over mobile internet; use Pages or a public tunnel instead.

## Optional temporary public preview of local edits

Inspection found no usable existing tunnel executable in PATH or the checked
local tool locations. The other saved local project's checkout contained no
development setup. An old ngrok configuration exists, but no usable ngrok binary
was found; its credentials were neither displayed nor copied. **cloudflared was
not installed**, and no packages were installed automatically.

Optional free installation, run yourself if needed:

```powershell
winget install --id Cloudflare.cloudflared --exact --source winget
```

This is the [Cloudflare package in Microsoft's WinGet repository](https://github.com/microsoft/winget-pkgs/tree/master/manifests/c/Cloudflare/cloudflared).
[Official download options](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/)
are also available. Open a new PowerShell terminal after installation.

Start the server and a Quick Tunnel together:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\preview.ps1 -Tunnel
```

Alternatively, keep the local preview running and use a second terminal:

```powershell
cloudflared tunnel --url http://localhost:4173
```

The helper prints **PUBLIC TUNNEL URL (iPhone/mobile internet)** followed by the
generated HTTPS address. Open that public address on the iPhone. The `localhost`
argument above is the tunnel's origin on the PC, never the phone's destination.
If a different server port was chosen, use the same port for the tunnel.

Cloudflare [Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)
are free temporary development URLs, with no permanent DNS setup. The URL changes
when restarted and works only while the PC/server/tunnel remain online. Keep
unfinished local content suitable for public viewing. No account token, named
tunnel or permanent configuration is created by the helper.

If cloudflared is missing, `-Tunnel` clearly reports that and starts LAN-only
preview. If cloudflared exits, the helper reports that the tunnel is unavailable
while leaving LAN preview running. Diagnostic logs stay in the OS temporary
directory, outside Git. Existing `.cloudflared/config.yaml` can prevent Quick
Tunnels; the helper never renames or edits existing tunnel configuration.

## Verification on Windows, 11 September 2026

- PC `localhost`, the dynamically detected LAN address and public Pages each
  served the current main HTML (normalizing Git's LF/CRLF line endings).
- Each surface was checked at 1440px and 390px. Live Supabase GET requests
  succeeded; Market 137 / Suitable 6 / Best 9 counts matched rendered cards
  after switching. No horizontal overflow, uncaught errors or Supabase writes.
- The public preview's primary Colliers link opened the correct real listing.
- Mobile viewport screenshot inspected. LAN was tested from the PC; a physical
  iPhone/mobile-carrier connection cannot be verified from this environment.
- Helper startup from this Unicode/space-containing path, missing-cloudflared
  fallback, occupied-port rejection and Ctrl+C child cleanup were checked.
- `python -B scripts/tests/preview-server.test.py`: four passing tests for root,
  JS/CSS assets/MIME types, private-path/directory blocking, HEAD/404 and rejected
  write methods. PowerShell parser check passed.
- A real tunnel could not be started/tested without cloudflared. No public tunnel
  URL is claimed. The public URL above is the already deployed GitHub Pages site.

Only preview helpers, helper tests and documentation changed. Application logic,
design, Supabase/schema/production data, ingestion and GitHub Actions are unchanged.
