import { EmptyState, MqSearch, Skeleton } from '@mirqam/ui'
import { lazy, Suspense } from 'react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import AppShell from './components/AppShell.jsx'
import PublicShell from './components/PublicShell.jsx'
import { useI18n } from './i18n/index.jsx'
import { useSession } from './lib/session.jsx'
import Auth from './pages/Auth.jsx'
import Landing from './pages/Landing.jsx'

const Dashboard = lazy(() => import('./pages/app/Dashboard.jsx'))
const Cashier = lazy(() => import('./pages/app/Cashier.jsx'))
const Members = lazy(() => import('./pages/app/Members.jsx'))
const MemberDetail = lazy(() => import('./pages/app/MemberDetail.jsx'))
const Programs = lazy(() => import('./pages/app/Programs.jsx'))
const Activity = lazy(() => import('./pages/app/Activity.jsx'))
const Staff = lazy(() => import('./pages/app/Staff.jsx'))
const Design = lazy(() => import('./pages/Design.jsx'))

function RequireAuth({ children, capability }) {
  const session = useSession()
  const location = useLocation()
  if (session.status === 'loading') return <Skeleton className="p-10" rows={2} />
  if (session.status === 'anon') return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />
  if (capability && !session.can(capability)) return <Navigate to="/app" replace />
  return children
}

function NotFound() {
  const { t } = useI18n()
  return (
    <PublicShell>
      <EmptyState
        icon={MqSearch}
        title={t('notFound.title')}
        desc={t('notFound.body')}
        action={
          <Link to="/" className="font-semibold text-accent">
            {t('notFound.home')}
          </Link>
        }
      />
    </PublicShell>
  )
}

export default function App() {
  return (
    <Suspense fallback={<Skeleton className="p-10" rows={2} />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Auth mode="login" />} />
        <Route path="/register" element={<Auth mode="register" />} />
        <Route path="/design" element={<Design />} />
        <Route
          path="/app"
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<Dashboard />} />
          <Route
            path="cashier"
            element={
              <RequireAuth capability="transact">
                <Cashier />
              </RequireAuth>
            }
          />
          <Route path="members" element={<Members />} />
          <Route path="members/:id" element={<MemberDetail />} />
          <Route path="programs" element={<Programs />} />
          <Route path="activity" element={<Activity />} />
          <Route
            path="staff"
            element={
              <RequireAuth capability="manage">
                <Staff />
              </RequireAuth>
            }
          />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}
