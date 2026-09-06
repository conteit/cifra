import { index, layout, type RouteConfig } from '@react-router/dev/routes';

/**
 * Two nested pathless layouts, in this order:
 *
 *   `routes/gate.tsx`      — identity and the vault. Renders the sign-in,
 *                            setup and unlock screens *instead of* everything
 *                            below it, and its `<Outlet />` only once the vault
 *                            is open (#9).
 *   `routes/app-layout.tsx` — the shell: nav, header, the responsive frame
 *                            (#3, FOUN-09).
 *
 * The gate is a wrapper rather than a `/sign-in` sibling reached by redirect,
 * so a deep link survives a cold load: the right screen renders *at* the URL
 * the user asked for, and the page appears underneath it when the vault opens.
 * `app/routes/gate.tsx` carries the full reasoning.
 *
 * `app/shell/nav-items.ts` names a path for all seven destinations; only the
 * ones registered here are marked `live`. `test/unit/shell/nav-routes.test.ts`
 * fails if those two lists ever disagree.
 */
export default [
  layout('routes/gate.tsx', [
    layout('routes/app-layout.tsx', [index('routes/home.tsx')]),
  ]),
] satisfies RouteConfig;
