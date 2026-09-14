# Mounted folder denial projection

Folder denial remains durable authority in the existing IndexedDB metadata
transaction. This slice adds a typed folder receipt with route/root aliases,
epoch, and generation. A receipt is emitted only after the marker transaction
commits; failure emits an unknown-generation receipt and suspends the cache
instead of claiming cleanup succeeded.

Readers project authority at read time. `getFolder` removes only denied
children and detaches descendants below a denied crumb to the nearest visible
parent. `getNoteList` additionally removes summaries directly assigned to a
denied folder while retaining notes in independently visible descendants.
Mounted views subscribe to the receipt channel and reload only their current
projection.
