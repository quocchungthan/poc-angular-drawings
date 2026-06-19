# LeafletPicturePoc

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.2.16.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
npm run e2e
```

This project uses Playwright and runs tests headless by default.

## Docker: One Command Up

Use prebuilt public image (recommended for team demos):

Start container:

```bash
npm run up
```

Open app:

`http://localhost:8080`

Stop container:

```bash
npm run down
```

## Docker: Local Build

Build and run from local source (no registry dependency):

```bash
npm run up:local
```

## Public Image Pipeline (GHCR)

This repo includes [docker-publish.yml](.github/workflows/docker-publish.yml).

Behavior:
- On push to `main`, GitHub Actions builds Docker image from `Dockerfile`
- Pushes tags to GHCR:
  - `ghcr.io/<owner>/leaflet-picture-poc:latest`
  - `ghcr.io/<owner>/leaflet-picture-poc:sha-<commit>`

How to make image public:
1. Manual (default):
	- GitHub -> Packages -> `leaflet-picture-poc` -> Package settings -> Change visibility to `Public`
2. Automated (optional):
	- Add repository secret `GHCR_ADMIN_TOKEN` (PAT with package admin permissions)
	- Workflow will attempt to switch the container package visibility to `public` after push

Image reference in compose is hardcoded to:
- `ghcr.io/learn-mitec/leaflet-picture-poc:latest`

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
