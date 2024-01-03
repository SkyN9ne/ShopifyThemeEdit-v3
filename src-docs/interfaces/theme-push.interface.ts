// This is an autogenerated file. Don't edit this file manually.
export interface themepush {
  /**
   * Disable color output.
   */
  '--no-color'?: ''

  /**
   * Increase the verbosity of the logs.
   */
  '--verbose'?: ''

  /**
   * The path to your theme directory.
   */
  '--path <value>'?: string

  /**
   * Password generated from the Theme Access app.
   */
  '--password <value>'?: string

  /**
   * Store URL. It can be the store prefix (johns-apparel) or the full myshopify.com URL (johns-apparel.myshopify.com, https://johns-apparel.myshopify.com).
   */
  '-s, --store <value>'?: string

  /**
   * The environment to apply to the current command.
   */
  '-e, --environment <value>'?: string

  /**
   * Theme ID or name of the remote theme.
   */
  '-t, --theme <value>'?: string

  /**
   * Push theme files from your remote development theme.
   */
  '-d, --development'?: ''

  /**
   * Push theme files from your remote live theme.
   */
  '-l, --live'?: ''

  /**
   * Create a new unpublished theme and push to it.
   */
  '-u, --unpublished'?: ''

  /**
   * Runs the push command without deleting local files.
   */
  '-n, --nodelete'?: ''

  /**
   * Download only the specified files (Multiple flags allowed).
   */
  '-o, --only <value>'?: string

  /**
   * Skip downloading the specified files (Multiple flags allowed).
   */
  '-x, --ignore <value>'?: string

  /**
   * Output JSON instead of a UI.
   */
  '-j, --json'?: ''

  /**
   * Allow push to a live theme.
   */
  '-a, --allow-live'?: ''

  /**
   * Publish as the live theme after uploading.
   */
  '-p, --publish'?: ''
}
