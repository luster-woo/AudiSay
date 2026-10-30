import { createBrowserRouter } from 'react-router-dom'
import { RootProviders } from './providers'
import App from '@/App'

export const router = createBrowserRouter([
  {
    element: <RootProviders />,
    children: [{ path: '*', element: <App /> }],
  },
])
