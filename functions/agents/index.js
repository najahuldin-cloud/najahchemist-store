// Jarvis OS — Agent barrel.
//
// Aggregates each agent's exported Cloud Functions into a single object that
// functions/index.js spreads into its exports via a single additive line:
//   Object.assign(exports, require('./agents'));
//
// Phase 1: skeleton only. Every agent currently exports {} (no Cloud Functions),
// so this adds ZERO new deployed functions. Agent metadata (permissions/levels)
// lives in _shared/permissions.js, NOT here, so only real functions are exported.

module.exports = {
  ...require('./lead-agent'),
  ...require('./reorder-agent'),
  ...require('./book-agent'),
  ...require('./coaching-agent'),
  ...require('./marketing-commander'),
  ...require('./demand-hunter'),
  ...require('./ad-commander'),
  ...require('./content-commander'),
};
