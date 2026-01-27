import { useMatch } from "react-router-dom";
import ExpoAdminRoutes from "./ExpoAdminRoutes";
import AuthPageRoutes from "./AuthPageRoutes";
import MyPageRoutes from "./MyPageRoutes";
import MainPageRoutes from './MainPageRoutes';
import PlatformAdminRoutes from './PlatformAdminRoutes';

function AppRouteBody() {

  const matchAdminWildcard = useMatch("/expos/:expoId/admin/*");
  const matchAdminRoot = useMatch("/expos/:expoId/admin");
  const matchExpoAdmin = !!(matchAdminWildcard || matchAdminRoot);
  const matchPlatformWildcard = useMatch("/platform/admin/*");
  const matchPlatformRoot = useMatch("/platform/admin");
  const matchPlatformAdmin = !!(matchPlatformWildcard || matchPlatformRoot);
  
  console.log('🔍 Current location:', window.location.pathname);
  console.log('🔍 ExpoAdmin match result:', matchExpoAdmin);

  if (matchExpoAdmin) {
    return <ExpoAdminRoutes />;
  }

  if (matchPlatformAdmin) {
    return <PlatformAdminRoutes />;
  }

  return (
    <>
      <MainPageRoutes />
      <AuthPageRoutes />
      <MyPageRoutes />
    </>
  );
}

export default AppRouteBody;
