import { type RouteConfig, index, layout } from '@react-router/dev/routes';

/**
 * Every page lives under the pathless app-shell layout, so nav, header and the
 * responsive frame come for free (issue #3, FOUN-09). Routes that must render
 * without the shell — #9's sign-in screen — go beside the `layout()` call, not
 * inside it.
 *
 * `app/shell/nav-items.ts` names a path for all seven destinations; only the
 * ones registered here are marked `live`. `test/unit/shell/nav-routes.test.ts`
 * fails if those two lists ever disagree.
 */
export default [
  layout('routes/app-layout.tsx', [index('routes/home.tsx')]),
] satisfies RouteConfig;
