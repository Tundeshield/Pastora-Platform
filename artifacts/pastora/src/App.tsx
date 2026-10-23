import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Route, Switch, Router as WouterRouter } from "wouter";

import { WorkspaceLayout } from "@/components/workspace-layout";
import { AppointmentsPage } from "@/pages/appointments";
import { AuthPage } from "@/pages/auth";
import { CarePortalPage } from "@/pages/care-portal";
import { DashboardPage } from "@/pages/dashboard";
import { ExpensesPage } from "@/pages/expenses";
import { DocumentPage, FeaturesPage, HomePage, NotFound, PricingPage } from "@/pages/marketing";
import { OnboardingPage } from "@/pages/onboarding";
import { PlatformPage } from "@/pages/platform";
import { QrPage } from "@/pages/qr-codes";
import { ReportsPage } from "@/pages/reports";
import { RequestsPage } from "@/pages/requests";
import { SettingsPage } from "@/pages/settings";
import { TasksPage } from "@/pages/tasks";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <ThemeRoot />
        <Router />
      </WouterRouter>
    </QueryClientProvider>
  );
}

function ThemeRoot() {
  const [theme, setTheme] = useState(() => localStorage.getItem("pastora-theme") || "warm-cream");
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("pastora-theme", theme);
  }, [theme]);
  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomePage} />
      <Route path="/features" component={FeaturesPage} />
      <Route path="/pricing" component={PricingPage} />
      <Route path="/sign-in">
        <AuthPage mode="sign-in" />
      </Route>
      <Route path="/sign-up">
        <AuthPage mode="sign-up" />
      </Route>
      <Route path="/forgot-password">
        <AuthPage mode="forgot" />
      </Route>
      <Route path="/verify-email">
        <AuthPage mode="verify" />
      </Route>
      <Route path="/onboarding" component={OnboardingPage} />
      <Route path="/app">
        <WorkspaceLayout>
          <DashboardPage />
        </WorkspaceLayout>
      </Route>
      <Route path="/app/requests">
        <WorkspaceLayout>
          <RequestsPage />
        </WorkspaceLayout>
      </Route>
      <Route path="/app/appointments">
        <WorkspaceLayout>
          <AppointmentsPage />
        </WorkspaceLayout>
      </Route>
      <Route path="/app/tasks">
        <WorkspaceLayout>
          <TasksPage />
        </WorkspaceLayout>
      </Route>
      <Route path="/app/qr-codes">
        <WorkspaceLayout>
          <QrPage />
        </WorkspaceLayout>
      </Route>
      <Route path="/app/reports">
        <WorkspaceLayout>
          <ReportsPage />
        </WorkspaceLayout>
      </Route>
      <Route path="/app/expenses">
        <WorkspaceLayout>
          <ExpensesPage />
        </WorkspaceLayout>
      </Route>
      <Route path="/app/settings">
        <WorkspaceLayout>
          <SettingsPage />
        </WorkspaceLayout>
      </Route>
      <Route path="/care/:slug" component={CarePortalPage} />
      <Route path="/privacy">
        <DocumentPage title="Privacy, with care" category="Privacy" />
      </Route>
      <Route path="/terms">
        <DocumentPage title="Terms of use" category="Terms" />
      </Route>
      <Route path="/support">
        <DocumentPage title="A human answer, when you need one" category="Support" />
      </Route>
      <Route path="/platform/workspaces">
        <PlatformPage />
      </Route>
      <Route>
        <NotFound />
      </Route>
    </Switch>
  );
}

export default App;
