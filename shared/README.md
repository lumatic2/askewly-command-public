# Shared task contract

This folder holds CommonJS modules that can be consumed by the Electron widget,
the optional local HTTP server, and future Expo code through a bundler alias.

`tasks.js` defines the cloud task contract for Supabase:

- Cloud task source keys are `today`, `deadlines`, and `backlog`.
- Cloud task source kinds are `today`, `deadline`, `backlog`, and `external`.
- Legacy file/widget source keys keep `deadline` singular for compatibility.
- Legacy statuses map to cloud statuses as `pending -> todo`,
  `in_progress -> doing`, `completed -> done`, and `cancelled -> archived`.

The current desktop code still uses its file-backed schedule model. New cloud
sync code should import this module instead of re-creating source/status maps.
