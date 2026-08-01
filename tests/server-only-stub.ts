// Vitest runs these modules in Node. Production builds still resolve Next's
// server-only package, so accidental client imports continue to fail closed.
export {};
