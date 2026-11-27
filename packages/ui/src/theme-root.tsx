import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';
import { odsInter } from './fonts';
import type { OdsDensity } from './tokens';

type Props<T extends ElementType> = {
  /** comfortable = customer areas (default), compact = staff apps (Part 2.2) */
  density?: OdsDensity;
  /** element to render; default `div` */
  as?: T;
  className?: string;
  children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'className' | 'children'>;

/**
 * The ODS 1.0 scope: `data-theme="ods"` + `data-density`, and the Inter variable class.
 * Every ODS shell (T3+) renders its frame inside one of these, chosen by `isOdsTheme()` in the area layout.
 * Tokens, the amber focus ring and the ods-* Tailwind utilities only work inside it.
 */
export function OdsThemeRoot<T extends ElementType = 'div'>({ density = 'comfortable', as, className, children, ...rest }: Props<T>) {
  const Tag: ElementType = as ?? 'div';
  return (
    <Tag data-theme="ods" data-density={density} className={[odsInter.variable, className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </Tag>
  );
}
