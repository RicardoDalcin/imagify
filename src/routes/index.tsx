import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'
import { test } from '@/engine'

export const Route = createFileRoute('/')({ component: App })

function App() {
  useEffect(() => {    
    test();
  }, [])
  
  return (
    <main className="page-wrap px-4 pb-8 pt-14">
      Hello
    </main>
  )
}
