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
    <main>
      <h1>Cifra</h1>
    </main>
  );
}
