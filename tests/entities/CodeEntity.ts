import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export class Code {
  constructor(public readonly value: string) {}
  toString() { return this.value; }
}

@Entity('codes')
export class CodeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'text',
    transformer: {
      to: (value: Code | null) => value === null ? null : value.value,
      from: (value: string) => new Code(value),
    },
  })
  code!: Code;
}
