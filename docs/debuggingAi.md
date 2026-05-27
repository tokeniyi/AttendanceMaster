# Attendance Master — Google Document AI Integration Debugging Instructions

## Objective

The Google Document AI SDK was integrated into the project, but the application is currently failing during compilation because Node.js-only modules are being imported into the client/browser bundle.

The purpose of this task is:

- Diagnose the import boundary problem
- Verify server/client separation
- Run tests only
- Produce a debugging report
- DO NOT refactor application logic
- DO NOT introduce architectural changes
- DO NOT modify unrelated files

This task is STRICTLY for debugging, validation, and testing.

---

# CURRENT ERROR SUMMARY

The project currently throws errors such as:

```txt
Module not found: Can't resolve 'fs'
Module not found: Can't resolve 'dns'
Module not found: Can't resolve 'child_process'
```

Import traces show:

```txt
src/OCR/ocrService.ts
↓
src/app/attendance/new/page.tsx
↓
Client Component Browser
```

This indicates that:

- `ocrService.ts` is being imported into a Client Component
- Google Document AI SDK is server-only
- Next.js is attempting to bundle Node.js modules into the browser
- Browser environments do not contain:
  - fs
  - dns
  - child_process
  - grpc internals

This is an architectural boundary issue.

---

# IMPORTANT UNDERSTANDING

The issue is NOT that Google Document AI is broken.

The issue is:

```txt
Server-side SDK
being imported into
Client-side React bundle
```

Google Document AI MUST execute ONLY on the server.

---

# STRICT TASK RULES

## DO NOT:

- rewrite application architecture
- migrate the entire app
- replace frameworks
- downgrade dependencies
- remove Google Document AI
- modify business logic
- change reconstruction systems
- alter semantic processing
- change OCR pipeline structure
- introduce hacks or polyfills
- add browser fallbacks for Node.js modules

---

# ALLOWED ACTIONS

You MAY:

- inspect imports
- inspect component boundaries
- inspect server/client separation
- run tests
- run build checks
- create debugging notes
- identify architectural violations
- recommend safe server-only placement

---

# PRIMARY INVESTIGATION GOALS

Investigate WHY:

```txt
src/OCR/ocrService.ts
```

is entering the browser bundle.

Determine:

- which component imports it
- whether `"use client"` is involved
- whether a client component imports a server module
- whether server actions are missing
- whether API routes should mediate OCR execution
- whether the page is accidentally treated as client-rendered

---

# EXPECTED ROOT CAUSE

Most likely issue:

```tsx
"use client"
```

exists in:

```txt
src/app/attendance/new/page.tsx
```

OR

a client component somewhere in the chain imports:

```ts
src/OCR/ocrService.ts
```

This forces Next.js to bundle Google SDK code into the browser.

---

# REQUIRED INVESTIGATION STEPS

## STEP 1 — Trace Imports

Identify the full import chain from:

```txt
src/app/attendance/new/page.tsx
```

to:

```txt
src/OCR/ocrService.ts
```

Document:

- direct imports
- indirect imports
- shared utility imports
- client/server boundaries

---

## STEP 2 — Check Client Components

Inspect all involved files for:

```tsx
"use client"
```

Determine whether:

- the page itself is a client component
- a child component is importing OCR logic
- server-only code crossed into client territory

---

## STEP 3 — Verify Server-Only Constraints

Confirm that the following remain server-only:

- @google-cloud/documentai
- google-gax
- grpc-js
- google-auth-library

These packages MUST NEVER enter the browser bundle.

---

## STEP 4 — Run Validation Tests

Run ONLY:

```bash
npm run dev
```

and:

```bash
npm run build
```

Capture:

- compile failures
- hydration warnings
- server/client boundary violations
- Next.js bundling errors

DO NOT attempt broad dependency migrations.

---

## STEP 5 — Produce Findings Report

Create a concise debugging report containing:

- identified root cause
- import boundary violations
- files involved
- why Node modules entered browser bundle
- safe architectural correction recommendations

---

# IMPORTANT NEXT.JS UNDERSTANDING

In Next.js App Router:

## Server Components
CAN:
- use fs
- use grpc
- use Google SDKs
- access environment variables
- access filesystem

## Client Components
CANNOT:
- import Node.js modules
- use fs
- use grpc
- use server SDKs

If a client component imports a server module,
the entire dependency chain becomes client-bundled.

That is exactly what is happening here.

---

# EXPECTED SAFE ARCHITECTURE

The OCR SDK should ultimately execute ONLY in:

- API routes
OR
- server actions
OR
- dedicated server utilities

The browser should NEVER directly import:

```ts
@google-cloud/documentai
```

---

# DO NOT IMPLEMENT YET

At this stage:

DO NOT perform the refactor.

ONLY:

- identify the issue
- validate the issue
- document the issue
- recommend safe correction paths

---

# SUCCESS CRITERIA

The task is successful if:

- the import boundary issue is clearly identified
- the server/client violation is documented
- tests are executed
- the cause of Node module resolution failures is fully understood
- recommendations are provided WITHOUT changing application behavior

---

# FINAL NOTE

This is a debugging and validation task ONLY.

Do not perform broad migrations or speculative fixes.

The objective is controlled diagnosis, not uncontrolled modification.