import Link from 'next/link';
import { Logo } from '@/components/ui';
import { getSiteContent, block } from '@/lib/content';
import { getSession } from '@/lib/auth';

/** Storefront layout header + mega-menu (Main.png). All copy from CMS. */
export async function StoreHeader() {
  const [{ blocks, company, categories, settings }, session] = await Promise.all([getSiteContent(), getSession()]);
  const top = categories.filter((c) => c.level === 1);
  const wa = company?.whatsapp ? `https://wa.me/${company.whatsapp.replace(/\D/g, '')}` : '#';
  return (
    <>
      <div className="bg-navy text-[#D5DBE4] text-[13px]">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-8 py-2 flex flex-wrap gap-x-6 gap-y-1 justify-between items-center">
          <span>{block(blocks, 'topbar.left')}</span>
          <div className="flex flex-wrap gap-5 items-center">
            <span>Ship to: Worldwide</span>
            <Link href="/contact" className="hover:text-white">Help center</Link>
            <a href={wa} className="hover:text-white" rel="noopener">WhatsApp sales</a>
          </div>
        </div>
      </div>
      <header className="bg-white border-b border-line">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-8 py-4 flex flex-wrap gap-x-7 gap-y-4 items-center">
          <Logo />
          <form action="/search" role="search" className="flex flex-[1_1_380px] min-w-0 border-[1.5px] border-navy rounded-[10px] overflow-hidden bg-white">
            <label htmlFor="cat" className="sr-only">Category</label>
            <select id="cat" name="c" className="border-r border-line px-3 bg-surface min-h-[46px] text-[15px] max-w-[160px]">
              <option value="">All categories</option>
              {top.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
            </select>
            <label htmlFor="q" className="sr-only">Search products</label>
            <input id="q" name="q" type="search" placeholder="Search products, HS codes or suppliers" className="flex-1 min-w-0 px-3.5 min-h-[46px] text-[15px] outline-none" />
            <button type="submit" className="btn btn-dark rounded-none min-h-[46px]" aria-label="Search">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            </button>
          </form>
          <nav className="flex flex-wrap gap-5 items-center text-[15px] font-medium" aria-label="Account">
            <Link href="/request/sourcing">Request Center</Link>
            {settings.supplier_portal_enabled === true && <Link href="/supplier">Sell on Octopus B2B</Link>}
            {session ? (
              <Link href={session.isStaff && !session.org ? (session.roles.includes('distributor') && !session.isAdmin ? '/distributor' : '/office') : '/account'} className="btn btn-primary">My account</Link>
            ) : (
              <>
                <Link href="/login">Sign in</Link>
                <Link href="/signup" className="btn btn-primary">Get started</Link>
              </>
            )}
          </nav>
        </div>
        <nav aria-label="Categories" className="max-w-[1280px] mx-auto px-4 sm:px-8 pb-3 flex gap-6 overflow-x-auto text-sm font-medium whitespace-nowrap">
          <Link href="/products" className="font-semibold">All categories</Link>
          {top.map((c) => <Link key={c.id} href={`/c/${c.slug}`} className="text-navy hover:text-blue">{c.name}</Link>)}
          <Link href="/request/3pl" className="text-blue">3PL services</Link>
          <Link href="/request/dropship" className="text-blue">Dropshipping</Link>
        </nav>
      </header>
    </>
  );
}

export async function StoreFooter() {
  const { blocks, company, branches } = await getSiteContent();
  const year = new Date().getFullYear();
  return (
    <footer className="bg-navy text-[#D5DBE4] mt-16">
      <div className="max-w-[1280px] mx-auto px-4 sm:px-8 py-12 grid gap-10 md:grid-cols-[1.6fr_1fr_1fr_1fr]">
        <div className="text-sm space-y-3">
          <Logo white />
          <p className="max-w-sm">{block(blocks, 'footer.about')}</p>
          {company && (
            <address className="not-italic space-y-1">
              <div className="font-semibold text-white">{company.legal_name}</div>
              <div className="text-[13px]">{company.address}</div>
              {company.contact_person && <div className="text-[13px]">Contact: {company.contact_person}</div>}
              {company.phone && <div className="font-semibold text-white">{company.phone} · WhatsApp</div>}
              {company.email && <a href={`mailto:${company.email}`} className="font-semibold text-white">{company.email}</a>}
            </address>
          )}
          {branches.length > 1 && <div className="text-[13px]">Branches: {branches.map((b) => b.city).join(' · ')}</div>}
        </div>
        <FooterCol title="Marketplace" links={[['/products', 'Products'], ['/products', 'Categories'], ['/request/sourcing', 'Request Center']]} />
        <FooterCol title="Suppliers" links={[['/contact', 'Sell on Octopus B2B'], ['/about', 'Verification'], ['/login', 'Supplier login']]} />
        <FooterCol title="Company" links={[['/about', 'About us'], ['/contact', 'Contact'], ['/legal/privacy', 'Privacy policy'], ['/legal/terms', 'Terms of service']]} />
      </div>
      <div className="border-t border-white/10">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-8 py-5 text-[13px]">© {year} {company?.brand ?? 'Octopus B2B'} · {company?.legal_name}. All rights reserved.</div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <div className="font-semibold text-white mb-3">{title}</div>
      <ul className="space-y-2 text-sm">{links.map(([h, l]) => <li key={l}><Link href={h} className="hover:text-white">{l}</Link></li>)}</ul>
    </div>
  );
}
