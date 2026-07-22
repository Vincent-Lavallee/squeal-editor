---
name: backlog
description: Log an item to the backlog, or move a finished one to completed. Grills the idea before writing it down, so only understood work gets recorded. Use when the user wants to log, park, capture, or note an idea, bug, improvement or feature — or mark backlog work done.
---

# Backlog

Two files at the repo root:

- `backlog.md` — work to do, in three sections: **Improvements**, **Bugs**,
  **Features**. Always those three, always in that order. Do not add a fourth.
- `completed.md` — work that shipped, newest last.

Keep both stupid simple. They are lists. They are not a tracker, they have no
priorities, no estimates, no IDs, no status fields. Resist adding any.

## One item, one grilling

**Every item gets its own separate grilling. No exceptions, no batching.**

If the user offers twenty items, that is twenty gruellings and twenty rounds of
questions — not one conversation that covers twenty things. Take them one at a
time, in the order given: grill item 1 to resolution, write it, then start item 2
cold. Never open with "let me ask about all of these", never fold several items
into one round of questions, and never let one answer stand in for another item's
grilling because the two sound related.

The pressure to batch grows as the list gets longer — that is exactly backwards.
Item 20 is the one most likely to be a half-formed thought the user tacked on,
and it needs the grilling *more* than item 1 did, not less. If a session is
getting long, stop and offer to continue later. Do not speed up.

What you may carry between items is context (things established about the code,
or a decision the user already made). What you may not carry is resolution: each
item still has to answer its own questions below, out loud, before it is written.

Write each item as soon as its grilling resolves. Do not save them all for the
end — an interrupted session should leave finished items on disk, not lost.

Grilling may reveal that two proposed items are really one, or that one is really
two. That is a *finding*, and it is fine. Merging items to save yourself grilling
rounds is not the same thing, and it is not fine.

## Adding an item

**1. Invoke the `grill-me` skill first. Always, before writing anything.**

This is the whole point of logging through a skill. An unexamined item is worse
than no item: it rots in the list until someone rediscovers why it was vague. Do
not skip the grilling because the item "seems obvious" or the user was brief —
brief requests are exactly the ones hiding an unresolved decision. Grill until
you can state the item in one line and the user agrees that line is right.

The grilling should settle, at minimum:

- What is actually wrong or missing, as opposed to the fix that was proposed?
- Which of the three sections is it? If it's arguably two, it's probably two
  items, or the framing is still wrong.
- Why does it matter — what does the user hit today because of it?
- Is it already covered by an existing item?

If grilling reveals the item is already done, or shouldn't be done, say so and
write nothing.

**2. Write one bullet in the right section:**

```md
- **Short feature-named title** — what is wrong or missing, and why it matters.
```

One or two sentences after the dash. If it needs a paragraph, the grilling was
not finished.

## The naming rule

**Refer to things by feature name. Never by file name or function name.**

Write "the connection list", "the result grid", "the extension heartbeat",
"multi-statement execution". Not a path, not an identifier, not a symbol.

Two reasons, and the second is the real one:

1. Files get renamed and functions get inlined. A backlog outlives both, and an
   item pointing at a file that no longer exists is an item nobody trusts.
2. If you cannot describe the item without naming code, you have written down a
   patch instead of a problem — and you don't yet understand the problem. Go
   back and grill.

This applies to `completed.md` too, for the same reasons.

## Completing an item

Move the bullet from `backlog.md` to the end of `completed.md`, unchanged, with
the date prepended:

```md
- **2026-07-15** — **Short feature-named title** — what was wrong, and why it mattered.
```

Do not rewrite it to describe the fix. The item said what was wrong; the code
says what was done; `docs/decisions.md` says why it was done that way. Delete it
from `backlog.md` in the same change — an item in both files is a lie in one of
them.

If work was finished that was never in the backlog, it can go straight to
`completed.md`. No grilling needed — it's already done, there's nothing left to
resolve.
