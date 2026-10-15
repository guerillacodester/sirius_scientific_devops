import './styles.css';

export const metadata = {
  title: 'Sirius Scientific DevOps',
  description: 'Premium local MantisBT-backed DevOps dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
