# Optional GitHub authorization

Public discovery remains anonymous. Private discovery is opt-in and begins only
when the user explicitly connects GitHub from the local CLI or loopback dashboard.

## Authorization model

Use a GitHub App installation, not a broad OAuth `repo` token. The app asks for
read-only **Contents** access, is installed on repositories selected by the user,
and uses the user-to-server OAuth flow solely to identify the user's installation.
The resulting short-lived installation token is scoped by GitHub to that selected
repository set. Metadata is read-only. No organization administration, workflow,
issues, pull-request write, or repository-write permission is requested.

The app client ID, redirect URI, and application slug may be committed as public
configuration. The private key and client secret cannot: they belong to a hosted
broker or a user-controlled local credential manager. Loadout never asks the user to
paste a token into a manifest, catalog, log, or dashboard URL.

## Local flow and failure modes

1. `loadout connect github` opens a browser using PKCE and a loopback callback.
2. The local process verifies `state`, PKCE verifier, expiration, and callback host.
3. It stores only an OS-keychain reference to the refresh/session material.
4. `loadout discover --private` obtains a short-lived installation token in memory,
   lists only selected repositories, and discards it after the request.
5. `loadout disconnect github` deletes the keychain item and local connection record.

If no registered GitHub App/client and secure credential backend are configured,
private discovery stays unavailable and public discovery keeps working. A token that
cannot be refreshed or no longer has access is reported as disconnected; it is never
silently retried with a broader scope.

## Non-goals

This does not clone private repositories, execute private source, or expose private
repository names in shared exports. A user must still explicitly add and plan a
repository before Loadout fetches it.
