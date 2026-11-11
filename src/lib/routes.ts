const ROUTE_LABELS: Record<string, string> = {
  peninsula: "Antarctic Peninsula",
  antarctic_circle: "Antarctic Circle",
  falklands_south_georgia: "Falklands & South Georgia",
  fly_cruise: "Fly-cruise",
};

export function routeLabel(route: string): string {
  return ROUTE_LABELS[route] ?? route;
}
