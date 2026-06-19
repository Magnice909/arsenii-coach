import { useEffect, useState } from "react";
import Index from "./pages/Index";
import Login from "./pages/Login";
import CoachDashboard from "./pages/CoachDashboard";
import ClientDashboard from "./pages/ClientDashboard";
import { getUser } from "./lib/storage";

const getRoute = () => window.location.hash.replace("#", "") || "/";

export default function App() {
  const [route, setRoute] = useState(getRoute());

  useEffect(() => {
    const onHashChange = () => setRoute(getRoute());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const user = getUser();

  if (route === "/login") return <Login />;
  if (route === "/coach") return user?.role === "coach" ? <CoachDashboard /> : <Login />;
  if (route === "/client") return user?.role === "client" ? <ClientDashboard /> : <Login />;
  return <Index />;
}
