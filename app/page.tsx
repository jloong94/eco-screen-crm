export default function Home() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const cloudConfigScript = `
    (function () {
      var url = ${JSON.stringify(supabaseUrl)};
      var anonKey = ${JSON.stringify(supabaseAnonKey)};
      if (url && !localStorage.getItem("eco-screen-supabase-url")) {
        localStorage.setItem("eco-screen-supabase-url", url);
      }
      if (anonKey && !localStorage.getItem("eco-screen-supabase-anon-key")) {
        localStorage.setItem("eco-screen-supabase-anon-key", anonKey);
      }
    })();
  `;

  return (
    <main className="h-screen w-screen overflow-hidden bg-white">
      <script dangerouslySetInnerHTML={{ __html: cloudConfigScript }} />
      <iframe
        title="Eco Screen CRM"
        src="/Eco-Screen-Quotation-System.html"
        className="h-full w-full border-0"
      />
    </main>
  );
}
