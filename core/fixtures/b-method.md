# B-Method fixture

Untagged fences in a B document are detected as B.

```
MACHINE TenantRateLimiter
SETS TENANT
DEFINITIONS scope_TENANT == 1..2; SET_PREF_MAXINT == 10
CONSTANTS capacity, refill, max_ticks
PROPERTIES capacity = 3 & refill = 1 & max_ticks = 4
VARIABLES tokens, accepted, ticks
INVARIANT
  tokens : TENANT --> 0..capacity &
  accepted : TENANT --> NAT &
  ticks : 0..max_ticks &
  !t.(t : TENANT => accepted(t) + tokens(t) <= capacity + refill * ticks)
INITIALISATION
  tokens := TENANT * {capacity} || accepted := TENANT * {0} || ticks := 0
OPERATIONS
  ok <-- ingest(t) =
    PRE t : TENANT THEN
      IF tokens(t) > 0 THEN
        tokens(t) := tokens(t) - 1 || accepted(t) := accepted(t) + 1 || ok := TRUE
      ELSE
        ok := FALSE
      END
    END;
  tick =
    SELECT ticks < max_ticks THEN
      tokens := %t.(t : TENANT | min({capacity, tokens(t) + refill})) ||
      ticks := ticks + 1
    END
END
```

## Operations

A mutant, as a diff:

```diff
- min({capacity, tokens(t) + refill})
+ tokens(t) + refill
```

ProB's counterexample:

```
1: SETUP_CONSTANTS(capacity=3,refill=1,max_ticks=4)
2: INITIALISATION(accepted={(TENANT1|->0),(TENANT2|->0)},ticks=0,tokens={(TENANT1|->3),(TENANT2|->3)})
3: ingest(TENANT1)-->TRUE
4: tick
Invariant 2 (Line:14 Col:2) is false (in state with id 7):
tokens : TENANT --> 0 .. capacity
```

Plain text stays plain:

```
time:      0   1   2   3
          [ block A ][ head ]
```
