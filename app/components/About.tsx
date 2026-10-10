import { REPO_URL } from './Header';

const doc = (path: string) => `${REPO_URL}/blob/main/${path}`;

export function About() {
  return (
    <footer className="about" id="about">
      <div className="about-grid">
        <section>
          <h2 className="micro">What this is</h2>
          <p>
            A fixed-physics benchmark. A candidate machine is a JSON assembly of
            rigid parts and passive joints — hinges, rails, welds and springs.
            Four input sockets are set before each run; one torque-limited crank
            turns for 4 s, the machine settles for 2 s, and three output gauges
            are read over the final 0.5 s. Rapier 2D simulates everything in a
            worker in your browser.
          </p>
          <p>
            The default reference adder shows the task is solvable. It was
            designed by Claude agents iterating with simulator feedback while
            this lab was built, so it is a feasibility witness, not a benchmark
            result: no model comparison has been run yet.
          </p>
        </section>
        <section>
          <h2 className="micro">What it is not</h2>
          <p>
            Joints are ideal and the model is mechanism-level: bodies that share
            a non-spring joint do not collide, and depth is only visual. A
            passing design would not show real tooth meshing, manufacturability
            or a programmable computer. This is not a fabrication claim.
          </p>
        </section>
        <section>
          <h2 className="micro">Where the arithmetic lives</h2>
          <p>
            Only in the evaluator. The viewer never adds: it shows the inputs
            you set and decodes what the gauges physically measure. Browser
            results are for development — final scoring uses the separately
            trusted CLI evaluator with private seeds.
          </p>
        </section>
        <section>
          <h2 className="micro">Read more</h2>
          <ul className="links">
            <li>
              <a href={doc('README.md')} target="_blank" rel="noreferrer">
                README
              </a>
            </li>
            <li>
              <a
                href={doc('docs/machine-format.md')}
                target="_blank"
                rel="noreferrer"
              >
                Machine format &amp; interface
              </a>
            </li>
            <li>
              <a
                href={doc('docs/experiment.md')}
                target="_blank"
                rel="noreferrer"
              >
                Experiment protocol
              </a>
            </li>
            <li>
              <a
                href={doc('docs/validation.md')}
                target="_blank"
                rel="noreferrer"
              >
                Validation &amp; limitations
              </a>
            </li>
          </ul>
        </section>
      </div>
      <p className="colophon">
        Runs entirely in this browser: no account, no telemetry, no uploads.
        Share links carry the machine inside the URL fragment.
      </p>
    </footer>
  );
}
