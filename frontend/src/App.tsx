import { AnimatePresence, domAnimation, LazyMotion, m, MotionConfig } from "framer-motion";
import { lazy, Suspense } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout";
import { PanelSkeleton, Skeleton } from "./components/ui";
import { AnalysisProvider, StatusProvider } from "./status";

const AnalysePage = lazy(() => import("./pages/Analyse"));
const DetectionLimitPage = lazy(() => import("./pages/DetectionLimit"));
const ValidationPage = lazy(() => import("./pages/Validation"));
const AboutPage = lazy(() => import("./pages/About"));
const PrivacyPage = lazy(() => import("./pages/Privacy"));
const NotFoundPage = lazy(() => import("./pages/NotFound"));

function PageFallback() {
  return (
    <div className="space-y-4" aria-label="Loading page">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-full max-w-xl" />
      <PanelSkeleton height={280} />
    </div>
  );
}

export default function App() {
  const location = useLocation();
  return (
    <LazyMotion features={domAnimation} strict>
    <MotionConfig reducedMotion="user">
      <StatusProvider>
        <AnalysisProvider>
          <Layout>
            <AnimatePresence mode="wait" initial={false}>
              <m.div
                key={location.pathname}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              >
                <Suspense fallback={<PageFallback />}>
                  <Routes location={location}>
                    <Route path="/" element={<AnalysePage />} />
                    <Route path="/detection-limit" element={<DetectionLimitPage />} />
                    <Route path="/validation" element={<ValidationPage />} />
                    <Route path="/about" element={<AboutPage />} />
                    <Route path="/privacy" element={<PrivacyPage />} />
                    <Route path="*" element={<NotFoundPage />} />
                  </Routes>
                </Suspense>
              </m.div>
            </AnimatePresence>
          </Layout>
        </AnalysisProvider>
      </StatusProvider>
    </MotionConfig>
    </LazyMotion>
  );
}
