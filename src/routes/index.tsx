import { createFileRoute } from "@tanstack/react-router";
import { Planner } from "@/components/planner/planner";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <Planner />;
}
