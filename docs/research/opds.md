# OPDS 1.2 Research & Compatibility Specification

## Overview
Open Publication Distribution System (OPDS) 1.2 is an open standard built upon the Atom syndication format (RFC 4287) and Dublin Core metadata to enable catalog aggregation and acquisition of digital publications.

## Feed Types
1. **Navigation Feed (`kind=navigation`)**:
   - Contains links pointing to sub-catalogs, genres, authors, or acquisition feeds.
   - Used for hierarchical catalog navigation.
2. **Acquisition Feed (`kind=acquisition`)**:
   - Contains Atom `<entry>` elements representing individual book publications.
   - Contains publication metadata and acquisition links.

## Atom Entry Structure & Dublin Core Metadata
Each publication `<entry>` typically includes:
- `<id>`: Unique identifier (URN, URI, or internal catalog ID).
- `<title>`: Publication title.
- `<author><name>`: Author name(s).
- `<updated>`: Timestamp of last metadata update.
- `<summary>` / `<content>`: Synopsis or blurb.
- `<dc:identifier>`: ISBN or UUID.
- `<dc:language>`: Language code (e.g. `en`, `es`).
- `<dc:publisher>`: Publisher name.
- `<dc:issued>` / `<published>`: Publication date.

## Acquisition & Auxiliary Links
- `rel="http://opds-spec.org/acquisition"`: Link to download the publication file (e.g., `type="application/epub+zip"`).
- `rel="http://opds-spec.org/acquisition/open-access"`: Explicitly DRM-free / public domain / open access download.
- `rel="http://opds-spec.org/image"`: High-resolution cover artwork.
- `rel="http://opds-spec.org/image/thumbnail"`: Low-resolution thumbnail for catalog lists.
- `rel="http://opds-spec.org/facet"`: Facet links for sorting/filtering (e.g., by popularity, date).
- `rel="next"` / `rel="previous"`: Pagination links.
- `rel="search"`: Link to an OpenSearch description XML (`application/opensearchdescription+xml`).

## Authentication & Security
- **Authentication**:
  - HTTP Basic Auth (`Authorization: Basic base64(user:pass)`).
  - Bearer Token Auth (`Authorization: Bearer <token>`).
  - Secure credential storage (passwords stored encrypted or in native key store, not plain text).
- **XML Security**:
  - Prevent XML Entity Expansion (Billion Laughs) and XXE (XML External Entity injection).
  - Standard browser `DOMParser` does not fetch external DTDs/entities, making it safe for client-side parsing if configured without entity evaluation.
- **URL Resolution**:
  - All relative `href` links must be resolved against the feed URL or `xml:base` attribute if present.
  - Enforce whitelist on URI schemes: allow `http:`, `https:`; reject `file:`, `javascript:`, `content:`.

## Ecosystem Variations (Komga, Kavita, Calibre-Web)
- Many OPDS 1.2 implementations diverge slightly in pagination (e.g., query params vs path segments).
- Some servers omit total results or link relations.
- The OPDS client must be forgiving with missing optional fields while maintaining strict type safety in the domain model.
