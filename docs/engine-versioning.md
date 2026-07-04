# Engine versioning

The worker Dockerfile (Phase 1) pins one official Stockfish release and
downloads it at image build time; that version string is part of every engine
record's cache key. CI installs the distribution's stockfish package via apt
only to exercise the UCI wrapper against a real engine at a tiny node budget;
CI results are never cached as engine records. Every engine record stamps the
version the running binary itself reports in its "id name" UCI response, so a
record can never be attributed to an assumed version.
