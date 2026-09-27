import { Download, ExternalLink } from 'lucide-react';
import { Link } from 'react-router';
import { EXPORT_XLSX_URL } from '../api';
import { TAEA_URL } from '../lib/vocab';

/** Site footer with credits (SPEC: spreadsheet + community, Apple previews, Wikipedia, TAEA link, not affiliated). */
export function Footer() {
  return (
    <footer className="site-footer" data-testid="site-footer">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            <p className="footer-title">
              <span aria-hidden="true">🌟 </span>STAR Song Finder
            </p>
            <p>Find your spotlight song for the STAR Festival’s Musical Theatre Solo & Duet categories — then go break a leg!</p>
            <a className="btn btn-ghost btn-sm" href={TAEA_URL} target="_blank" rel="noreferrer">
              Official Regional STAR Fest info <ExternalLink size={14} aria-hidden="true" />
            </a>
          </div>
          <div>
            <p className="footer-heading">Explore</p>
            <ul className="footer-links">
              <li>
                <Link to="/songs">Browse all songs</Link>
              </li>
              <li>
                <Link to="/shows">Shows</Link>
              </li>
              <li>
                <Link to="/match">Song Matchmaker</Link>
              </li>
              <li>
                <Link to="/star-prep">STAR Prep & rules</Link>
              </li>
              <li>
                <Link to="/add">Add a song</Link>
              </li>
              <li>
                <a href={EXPORT_XLSX_URL} download>
                  <Download size={13} aria-hidden="true" style={{ display: 'inline', verticalAlign: '-2px' }} /> Download the list (.xlsx)
                </a>
              </li>
            </ul>
          </div>
          <div className="footer-credits">
            <p className="footer-heading">Credits</p>
            <p>Song list from the STAR spreadsheet, plus songs added by our community.</p>
            <p>30-second previews courtesy of Apple Music via the iTunes Search API. Show info &amp; posters via Wikipedia (see each show for credits).</p>
            <p>
              Festival details:{' '}
              <a href={TAEA_URL} target="_blank" rel="noreferrer">
                taeacanada.ca/regional-star-fest
              </a>
            </p>
          </div>
        </div>
        <div className="footer-bottom">
          <span>A student-friendly fan project — not affiliated with or endorsed by TAEA (Theatrical Arts Education Association).</span>
          <span>Always confirm song eligibility &amp; licensing with your teacher.</span>
        </div>
      </div>
    </footer>
  );
}
