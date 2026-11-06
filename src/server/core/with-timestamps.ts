/**
 * `@MongoSchema({ timestamps: true })` makes Mongoose maintain `createdAt` and
 * `updatedAt`, but the schema classes do not declare them (the decorators have
 * nothing to say about fields Mongoose adds itself), so the document type has
 * no such property. This is the typed way to read them.
 */
export type WithTimestamps<T> = T & { createdAt: Date; updatedAt: Date };
