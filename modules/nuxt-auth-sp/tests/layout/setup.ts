// Deliberately no `box-sizing: border-box` preflight here.
//
// The app suites add one, because their components are written on top of
// Tailwind's reset and measure 26px too wide without it. OpenApeAuth is the
// opposite case: it is embedded on hosts we do not control, so it declares
// `box-sizing: border-box` on its own card and input. Handing it a preflight
// would grant it the very rule it is supposed to bring, and the card would
// keep fitting the screen even after that rule was deleted.
//
// A bare document is the honest stage for a widget that has to stand alone.
export {}
