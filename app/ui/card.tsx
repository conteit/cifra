import type { ComponentPropsWithRef, ElementType } from 'react';

import { cx } from './cx';

/**
 * `default` — cream card on the page, ruled and lifted a hair.
 * `inverse` — the ink hero panel the overview's headline figure sits on.
 */
export type CardTone = 'default' | 'inverse';

export interface CardProps extends ComponentPropsWithRef<'div'> {
  /**
   * The element to render. Cards are containers, and a container's meaning is
   * the page's business: an overview panel is a `section`, a transaction group
   * is an `article`, a card inside a list is an `li`.
   */
  as?: 'div' | 'section' | 'article' | 'li';
  tone?: CardTone;
  /** `float` is for content that leaves the page plane — sheets, hero panels. */
  elevation?: 'card' | 'float';
  /**
   * Set `false` for cards that host full-bleed content — a divided list of
   * rows needs its own rules to reach the card edge.
   */
  padded?: boolean;
}

const toneClasses: Record<CardTone, string> = {
  default: 'border border-rule bg-surface-card text-text-primary',
  inverse: 'bg-surface-inverse text-text-inverse',
};

/**
 * The paper every panel in the app is printed on.
 *
 * Purely presentational and layout-free: it sets surface, rule, radius,
 * elevation and padding, and nothing else. Width, grid placement and margins
 * come from the caller through `className`.
 */
export function Card({
  as = 'div',
  tone = 'default',
  elevation = 'card',
  padded = true,
  className,
  children,
  ...rest
}: CardProps) {
  // The prop is a closed union of container elements that all accept the same
  // div-shaped props; the cast keeps that union out of the public type.
  const Tag = as as ElementType;

  return (
    <Tag
      className={cx(
        'rounded-card',
        toneClasses[tone],
        elevation === 'float' ? 'shadow-float' : 'shadow-card',
        padded && 'px-8 py-6',
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
