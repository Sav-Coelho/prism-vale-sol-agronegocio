// Declaração ambiente mínima para createPortal — o projeto não tem
// @types/react-dom (npm install trava na pasta sincronizada do Drive).
declare module 'react-dom' {
  import type { ReactNode, ReactPortal } from 'react'
  export function createPortal(
    children: ReactNode,
    container: Element | DocumentFragment,
    key?: string | null,
  ): ReactPortal
}
