/** Plain-words explanations of the contract's errors, for the relayer and the app. */
export const ERROR_TEXT: Record<string, string> = {
  BadNonce: "This was signed out of order. Sign it again.",
  Expired: "The signature ran out of time. Sign it again.",
  ValidTooLong: "A signature can be valid for at most 7 days.",
  NotAllowed: "Only the person who spends the pot, or the funder, can pay from it.",
  NoSuchPot: "There is no pot with that number.",
  PotClosed: "This pot is closed.",
  PotEnded: "This pot has passed its end date, so it can't pay anyone.",
  PotNotEnded: "The money can go back to the funder only after the end date.",
  BadAddress: "That address can't be a payee here (the funder, the recipient and pot addresses can't be paid).",
  BadEnd: "Pick an end date later than the current one.",
  BadToken: "That token can't be used for a pot.",
  TooManyPayees: "A pot starts with 1 to 10 payees and can have at most 50.",
  DuplicatePayee: "The same payee is listed twice.",
  NotApproved: "That payee isn't approved for this pot.",
  NotConfirmed: "This pot only pays payees who have confirmed their address.",
  AlreadyApproved: "That payee is already approved.",
  ZeroAmount: "Enter an amount above zero.",
  NotEnoughInPot: "There isn't enough money in the pot for that.",
  NothingToMove: "There is nothing left in the pot to move.",
  TextTooLong: "That text is empty or too long.",
  TextNotPrintable: "Use plain letters, numbers and punctuation (no line breaks or special characters).",
  NoPqcKey: "That account has no post-quantum key on QoreChain yet. Send any transaction from QoreX once to register it.",
  NotMlDsa87: "That account's post-quantum key isn't ML-DSA-87.",
  PossessionNotProven: "That account's post-quantum key was registered without a proof of possession.",
  BadSignatureLength: "That isn't a post-quantum (ML-DSA-87) signature.",
  BadPqcSignature: "The post-quantum signature doesn't match. It must be signed in QoreX by the right account.",
  PqcUnavailable: "QoreChain's post-quantum check didn't answer. Try again in a moment.",
  WrongChain: "This contract belongs to another chain.",
};

export function explainError(name: string | undefined): string {
  return (name && ERROR_TEXT[name]) || "The transaction was refused.";
}
