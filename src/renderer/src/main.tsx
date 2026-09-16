import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import MiniWidget from './MiniWidget'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')
const isMini = new URLSearchParams(window.location.search).get('mini') === '1'
createRoot(root).render(
  <React.StrictMode>{isMini ? <MiniWidget /> : <App />}</React.StrictMode>
)
