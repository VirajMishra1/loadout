# Update safety fixtures

These are inert, local-only fixture repositories used by the update safety
regression tests. They are not published packages and are never executed.

- `benign-v1` and `benign-v2` model a documentation-only skill improvement.
- `risky-v2` adds an inert hook-shaped script and a network domain reference.

The tests copy these files into temporary directories, inspect them statically,
and assert that Loadout either accepts the benign revision or quarantines the
risky revision until an explicit approval flag is supplied.
