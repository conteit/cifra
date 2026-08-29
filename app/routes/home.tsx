import type { Route } from './+types/home';

export function meta(_: Route.MetaArgs) {
  return [
    { title: 'Cifra' },
    {
      name: 'description',
      content: 'Privacy-first personal finance — local, encrypted',
    },
  ];
}

export default function Home() {
  return (
    <main className="mx-auto max-w-page px-8 py-16">
      <h1 className="font-display text-display text-text-primary">Cifra</h1>
    </main>
  );
}
