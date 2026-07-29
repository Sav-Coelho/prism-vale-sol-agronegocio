// Declaração mínima para createPortal — o projeto não tem @types/react-dom
// (npm install trava na pasta sincronizada do Drive; só usamos o portal).
import type { ReactNode, ReactPortal } from 'react'

declare module 'react-dom' {
  export function createPortal(
    children: ReactNode,
    container: Element | DocumentFragment,
    key?: string | null,
  ): ReactPortal
}
