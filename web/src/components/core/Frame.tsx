import type { ReactNode } from 'react';

export interface FrameProps {
  children: ReactNode;
}

/** Page chassis (`.layout-main`): the shared main shell so every state of a
 *  page renders in the same frame. Class name is the contract. */
export function Frame({ children }: FrameProps) {
  return <main className="layout-main">{children}</main>;
}
