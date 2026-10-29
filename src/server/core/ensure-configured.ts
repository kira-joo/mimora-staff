/*
 * The decorator metadata polyfill, in the module graph the routes run in.
 *
 * `instrumentation.ts`'s own `reflect-metadata` import only helps once
 * Next's instrumentation module has actually run in this process — under
 * Turbopack, module graphs can split such that a route handler's bundle
 * never shares that side effect. Importing it here too, first, in the one
 * module every route factory import already goes through, removes any
 * dependence on which graph loaded first.
 *
 * Configures the toolkit in the module graph the route handlers actually
 * run in.
 *
 * ## Why `instrumentation.ts` alone is not trusted
 *
 * `restaurant-platform-staff` (the reference architecture) found the
 * toolkit's configuration store did not reliably share across Turbopack's
 * split bundles: `instrumentation.ts` runs in its own bundle, and a
 * `configureToolkit()` call there can set config on a copy of the package no
 * route handler ever reads from. This side-effect import, first in
 * `route-factories.ts`, configures the toolkit again in the exact module
 * graph every route actually executes in — cheap insurance either way, and
 * `configureNextBackendToolkit()` is documented safe to call more than once
 * (each call fully replaces the previous configuration; no merging).
 */
import "reflect-metadata";
import { configureToolkit } from "./toolkit.config";

configureToolkit();

export {};
