import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { Redirect, Route, Switch, Router as WouterRouter } from "wouter";

import { AuthProvider } from "@/auth";
import { RequireModule, WorkspaceLayout } from "@/components/workspace-layout";
import { AdminPage } from "@/pages/admin";
import { AppointmentsPage } from "@/pages/appointments";
import { AuthPage } from "@/pages/auth";
import { CarePortalPage } from "@/pages/care-portal";
import { DashboardPage } from "@/pages/dashboard";
import { ExpensesPage } from "@/pages/expenses";
import { PrivacyPage, SupportPage, TermsPage } from "@/pages/legal";
import { FeaturesPage, HomePage, NotFound, PricingPage } from "@/pages/marketing";
import { BlogPage, PostEditorPage, PublicBlogPage, PublicPostPage } from "@/pages/blog";
import { MessageEditorPage, MessagesPage, PulpitPage } from "@/pages/messages";
import { ModulesPage } from "@/pages/modules";
import { OnboardingPage } from "@/pages/onboarding";
import { ReportsPage } from "@/pages/reports";
import { RequestsPage } from "@/pages/requests";
import { SettingsPage } from "@/pages/settings";
import { TasksPage } from "@/pages/tasks";
import { TeamPage } from "@/pages/team";
import { churchFromHost, mainUrl } from "@/site";
import { applyAppearance, storedAppearance } from "@/theme";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

// Apply the last-seen workspace appearance before first paint of the app.
applyAppearance(storedAppearance());

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

/** Anything else asked of a church's own address belongs to Pastora's main site. */
function ToMainSite() {
  useEffect(() => {
    window.location.replace(mainUrl(`${window.location.pathname}${window.location.search}`));
  }, []);
  return null;
}

/** grace.getpastora.app: the church's care page at "/", its blog at "/blog". */
function ChurchSite({ slug }: { slug: string }) {
  return (
    <Switch>
      <Route path="/">
        <CarePortalPage slug={slug} />
      </Route>
      <Route path="/blog">
        <PublicBlogPage slug={slug} />
      </Route>
      <Route path="/blog/:postId">
        <PublicPostPage slug={slug} />
      </Route>
      <Route>
        <ToMainSite />
      </Route>
    </Switch>
  );
}

function Router() {
  const churchSlug = churchFromHost();
  if (churchSlug) return <ChurchSite slug={churchSlug} />;
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
      {/* QR codes and email settings now live in Settings; old links still work. */}
      <Route path="/app/qr-codes">
        <Redirect to="/app/settings?tab=care" replace />
      </Route>
      <Route path="/app/reports">
        <WorkspaceLayout>
          <ReportsPage />
        </WorkspaceLayout>
      </Route>
      <Route path="/app/expenses">
        <WorkspaceLayout>
          <RequireModule id="expenses">
            <ExpensesPage />
          </RequireModule>
        </WorkspaceLayout>
      </Route>
      <Route path="/app/team">
        <WorkspaceLayout>
          <TeamPage />
        </WorkspaceLayout>
      </Route>
      <Route path="/app/messages/:id/pulpit">
        <RequireModule id="message-prep">
          <PulpitPage />
        </RequireModule>
      </Route>
      <Route path="/app/messages/:id">
        <WorkspaceLayout>
          <RequireModule id="message-prep">
            <MessageEditorPage />
          </RequireModule>
        </WorkspaceLayout>
      </Route>
      <Route path="/app/messages">
        <WorkspaceLayout>
          <RequireModule id="message-prep">
            <MessagesPage />
          </RequireModule>
        </WorkspaceLayout>
      </Route>
      <Route path="/app/blog/:id">
        <WorkspaceLayout>
          <RequireModule id="blog">
            <PostEditorPage />
          </RequireModule>
        </WorkspaceLayout>
      </Route>
      <Route path="/app/blog">
        <WorkspaceLayout>
          <RequireModule id="blog">
            <BlogPage />
          </RequireModule>
        </WorkspaceLayout>
      </Route>
      <Route path="/app/modules">
        <WorkspaceLayout>
          <ModulesPage />
        </WorkspaceLayout>
      </Route>
      <Route path="/app/account">
        <Redirect to="/app/settings?tab=email" replace />
      </Route>
      <Route path="/app/settings">
        <WorkspaceLayout>
          <SettingsPage />
        </WorkspaceLayout>
      </Route>
      <Route path="/care/:slug">
        <CarePortalPage />
      </Route>
      <Route path="/blog/:slug/:postId">
        <PublicPostPage />
      </Route>
      <Route path="/blog/:slug">
        <PublicBlogPage />
      </Route>
      <Route path="/privacy" component={PrivacyPage} />
      <Route path="/terms" component={TermsPage} />
      <Route path="/support" component={SupportPage} />
      <Route path="/admin" component={AdminPage} />
      <Route path="/platform/workspaces" component={AdminPage} />
      <Route>
        <NotFound />
      </Route>
    </Switch>
  );
}

export default App;
