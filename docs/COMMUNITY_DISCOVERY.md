# Community discovery boundary

Loadout's Hacker News connector calls the documented public Firebase API only:
`/v0/topstories.json` followed by `/v0/item/<id>.json`. It does not scrape Hacker
News HTML, sign in, post, vote, retain author profiles, or poll in the background.

The connector reports only a GitHub `owner/repository` mentioned by a current story,
the story score and comment count, and direct links to the story and discussion. A
community mention is an early-discovery signal, not a trust signal: it never changes
the verified catalog, starts a clone, or makes an installation eligible. The user must
still use `plan`, inspect the static safety report, and explicitly approve an install.

This design makes a viral repository visible quickly without turning social momentum
into an automatic recommendation or a supply-chain execution path.
