/**
 * Cost-widget PLACEHOLDER (DESIGN §5, feature #15). The persistent cost/budget
 * widget is filled by E7 (Analytics); the shell only reserves its slot in the
 * top bar so the chrome layout is stable. It renders nothing visible and invents
 * no data — intentionally empty until E7 mounts real content here.
 */
export function CostWidgetSlot() {
  return <div className="topbar__cost" data-slot="cost-widget" aria-hidden="true" />;
}
