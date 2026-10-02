import type { Rng } from './rng'

const MALE = [
  'Albert', 'Alfred', 'Ambrose', 'Archibald', 'Arthur', 'Augustus', 'Barnaby', 'Bartholomew', 'Basil', 'Benedict',
  'Cedric', 'Charles', 'Clement', 'Cornelius', 'Cuthbert', 'Edmund', 'Edgar', 'Edwin', 'Elias', 'Ernest',
  'Ezekiel', 'Felix', 'Francis', 'Frederick', 'Gideon', 'Gilbert', 'Harold', 'Horace', 'Hugo', 'Ignatius',
  'Isaac', 'Jasper', 'Josiah', 'Lionel', 'Lucius', 'Mortimer', 'Nathaniel', 'Oliver', 'Oswald', 'Percival',
  'Phineas', 'Reginald', 'Rupert', 'Silas', 'Septimus', 'Thaddeus', 'Theodore', 'Tobias', 'Walter', 'Wilfred',
]

const FEMALE = [
  'Ada', 'Adelaide', 'Agatha', 'Alice', 'Amelia', 'Beatrice', 'Charlotte', 'Clara', 'Constance', 'Cordelia',
  'Dorothea', 'Edith', 'Eleanor', 'Eliza', 'Emmeline', 'Esther', 'Evangeline', 'Florence', 'Georgiana', 'Harriet',
  'Hester', 'Imogen', 'Isadora', 'Josephine', 'Judith', 'Lavinia', 'Letitia', 'Lydia', 'Mabel', 'Margaret',
  'Marigold', 'Matilda', 'Millicent', 'Minerva', 'Muriel', 'Octavia', 'Ophelia', 'Philippa', 'Prudence', 'Rosalind',
  'Ruth', 'Sybil', 'Theodora', 'Ursula', 'Victoria', 'Violet', 'Winifred', 'Wilhelmina', 'Henrietta', 'Cecily',
]

const SURNAMES = [
  'Ashworth', 'Babbage', 'Blackwood', 'Brassington', 'Brunel', 'Cogsworth', 'Copperfield', 'Crankshaw', 'Fairweather',
  'Fernsby', 'Forge', 'Gearhart', 'Grimsby', 'Hargreaves', 'Holloway', 'Ironside', 'Kettleby', 'Lockwood', 'Marlowe',
  'Netherby', 'Oakhurst', 'Pemberton', 'Pennyworth', 'Quill', 'Ravenscroft', 'Rivet', 'Smithers', 'Sprocket',
  'Steamwright', 'Stokes', 'Thistlewood', 'Tinker', 'Underhill', 'Vane', 'Wexley', 'Whitcombe', 'Winterbourne',
]

export function firstName(rng: Rng, female: boolean): string {
  return rng.pick(female ? FEMALE : MALE)!
}

export function surname(rng: Rng): string {
  return rng.pick(SURNAMES)!
}

export function familyName(name: string): string {
  const space = name.indexOf(' ')
  return space < 0 ? name : name.slice(space + 1)
}
